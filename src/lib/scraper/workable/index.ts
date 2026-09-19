import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { AtsCompany } from "@/models/automation.model";
import type { JobDetails, ScraperResult } from "../types";
import type { ResolveResult, SearchOutcome } from "../ats/types";
import {
  ATS_TOKEN_REGEX,
  boardSlugFrom,
  delay,
  errorReason,
  humanizeToken,
  runDeadline,
} from "../utils";

// Workable's public account board: POST /v3/accounts/<slug>/jobs with an empty
// JSON body. A GET returns 404 — the listing is a POST even though it reads
// nothing.
//
// Verified live 19.09.2026 against the `action1` board: 16 postings arriving as
// a page of 10 and a page of 6.

interface WorkableListJob {
  id?: number;
  // The identifier every public URL is built from; `id` appears nowhere in one.
  shortcode: string;
  title?: string;
  remote?: boolean;
  location?: { country?: string; countryCode?: string; city?: string } | null;
  locations?: { country?: string; city?: string }[];
  state?: string;
  // Not `published_on`, and there is no `created_at` on the list at all — the
  // old collector asked for both and got neither.
  published?: string;
  type?: string;
  workplace?: string;
}

interface WorkableListResponse {
  total?: number;
  results?: WorkableListJob[];
  // Absent (not null) on the last page.
  nextPage?: string;
}

// The description is NOT on v3. It is on the v2 detail, split across three
// fields.
interface WorkableJobDetail {
  description?: string;
  requirements?: string;
  benefits?: string;
}

// Workable's workplace string -> WORKPLACE_TYPES enum key. Undefined for
// anything unrecognized; an unmeasured workplace must not be reported as
// on-site.
function mapWorkableWorkplace(raw?: string): string | undefined {
  switch (raw?.toLowerCase()) {
    case "remote":
      return "REMOTE";
    case "hybrid":
      return "HYBRID";
    case "on_site":
    case "onsite":
      return "ONSITE";
    default:
      return undefined;
  }
}

function locationLabel(job: WorkableListJob): string {
  // Every office the posting is listed under, so the strict-location gate can
  // match any of them. `city` is routinely an empty string on remote roles,
  // which is why the parts are filtered rather than joined blindly.
  const entries = job.locations?.length
    ? job.locations
    : job.location
      ? [job.location]
      : [];
  const labels = entries
    .map((entry) =>
      [entry.city, entry.country]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(", "),
    )
    .filter(Boolean);
  if (labels.length > 0) return Array.from(new Set(labels)).join(", ");
  return job.remote ? "Remote" : "";
}

export function workableJobUrl(token: string, shortcode: string): string {
  return `${APP_CONSTANTS.WORKABLE_BOARD_URL}/${token}/j/${shortcode}/`;
}

export function mapWorkableListJob(
  job: WorkableListJob,
  companyName: string,
  token: string,
): JobDetails {
  return {
    title: (job.title ?? "").trim(),
    // Not in the payload under any name — carried from the watchlist entry.
    company: companyName,
    location: locationLabel(job),
    // The v3 list carries no description; hydrateWorkableJobs fills the
    // survivors from v2.
    description: "",
    url: workableJobUrl(token, job.shortcode),
    postedDate: job.published,
    employmentType: job.type,
    workplaceType: mapWorkableWorkplace(job.workplace),
  };
}

// Fetch one board, page by page. The page size is TEN and is not a parameter:
// asking for more changes nothing, so a company with more than ten open roles
// is silently cut to its first ten unless the nextPage token is followed.
export async function fetchWorkableBoardJobs(
  name: string,
  token: string,
  signal?: AbortSignal,
): Promise<ScraperResult<{ jobs: JobDetails[]; total: number | null }>> {
  // One deadline for the whole loop, plus the run's own cancel.
  const deadline = runDeadline(
    APP_CONSTANTS.WORKABLE_FETCH_TIMEOUT_MS,
    signal,
  );

  try {
    const all: JobDetails[] = [];
    let total: number | null = null;
    let pageToken: string | undefined;
    const seenTokens = new Set<string>();

    for (let page = 0; page < APP_CONSTANTS.WORKABLE_MAX_PAGES; page++) {
      const response = await fetch(
        `${APP_CONSTANTS.WORKABLE_BASE_URL}/${encodeURIComponent(token)}/jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pageToken ? { token: pageToken } : {}),
          signal: deadline.signal,
        },
      );

      // 429 is distinct so the run surfaces the existing "rate limited" label.
      if (response.status === 429) {
        return { success: false, error: { type: "rate_limited" } };
      }
      if (!response.ok) {
        return {
          success: false,
          error: {
            type: "network",
            message: `Board '${token}' returned ${response.status}`,
          },
        };
      }

      const data: WorkableListResponse = await response.json();
      if (!Array.isArray(data.results)) {
        return {
          success: false,
          error: { type: "parse", message: `Board '${token}' malformed page` },
        };
      }

      if (typeof data.total === "number") total = data.total;
      all.push(...data.results.map((job) => mapWorkableListJob(job, name, token)));

      // The last page omits nextPage entirely. A repeated token means the
      // cursor is not advancing, and following it would refetch the same ten
      // rows up to WORKABLE_MAX_PAGES.
      if (!data.nextPage || seenTokens.has(data.nextPage)) break;
      seenTokens.add(data.nextPage);
      pageToken = data.nextPage;

      await delay(APP_CONSTANTS.WORKABLE_PAGE_DELAY_MS, signal);
    }

    return { success: true, data: { jobs: all, total } };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: { type: "network", message: `Board '${token}' timed out` },
      };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: { type: "network", message } };
  } finally {
    deadline.release();
  }
}

// Fetch a watchlist in parallel (bounded concurrency) with per-token isolation.
export async function searchWorkableJobs(
  companies: AtsCompany[],
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const limit = pLimit(APP_CONSTANTS.WORKABLE_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    companies.map(({ name, token }) =>
      limit(() => fetchWorkableBoardJobs(name, token, signal)),
    ),
  );

  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];
  let available: number | null = null;

  settled.forEach((result, index) => {
    const token = companies[index].token;
    if (result.status === "fulfilled") {
      if (result.value.success) {
        jobs.push(...result.value.data.jobs);
        // Only boards that answered contribute. A board that failed leaves the
        // total unknown rather than counting as zero available.
        if (result.value.data.total !== null) {
          available = (available ?? 0) + result.value.data.total;
        }
      } else {
        errors.push({ token, reason: errorReason(result.value.error) });
      }
    } else {
      const reason =
        result.reason instanceof Error ? result.reason.message : "Unknown error";
      errors.push({ token, reason });
    }
  });

  return { jobs, errors, coverage: { fetched: jobs.length, available } };
}

// Board slug out of a pasted apply.workable.com link (board page or deep
// posting link) or a bare slug, probed live. Without it the save boundary
// tested the whole pasted URL against ATS_TOKEN_REGEX and answered "Paste a
// Workable board token" to the link the wizard had just asked for.
//
// The name is the humanized slug and can be no better: the v3 list carries no
// company field at all, and there is no /accounts/<slug> endpoint to ask —
// v2 answers that path with a bare "Not Found". Verified live 19.09.2026.
export async function resolveWorkableBoard(
  input: string,
): Promise<ResolveResult> {
  const slug = boardSlugFrom(input, /apply\.workable\.com\/([a-z0-9_-]+)/i);
  const token = slug?.toLowerCase();
  if (!token || !ATS_TOKEN_REGEX.test(token)) {
    return {
      success: false,
      message: "Paste an apply.workable.com link or a board token",
    };
  }

  try {
    // A GET answers 404 on every board, existing or not; the listing is a POST
    // even though it reads nothing.
    const res = await fetch(
      `${APP_CONSTANTS.WORKABLE_BASE_URL}/${encodeURIComponent(token)}/jobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    if (res.status === 404) {
      return { success: false, message: `No Workable board found for '${token}'` };
    }
    if (!res.ok) {
      return {
        success: false,
        message: `Could not validate board (${res.status})`,
      };
    }
    res.body?.cancel(); // the status is the whole answer; skip the payload

    return { success: true, name: humanizeToken(token), token };
  } catch {
    return { success: false, message: "Could not reach Workable" };
  }
}

// The stored posting URL is the only handle hydrate gets back, so the slug and
// shortcode the v2 detail needs are parsed out of it again.
export function parseWorkableJobUrl(
  url: string,
): { token: string; shortcode: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "apply.workable.com") return null;
    const [token, j, shortcode] = parsed.pathname
      .replace(/^\//, "")
      .split("/")
      .filter(Boolean);
    if (!token || j !== "j" || !shortcode) return null;
    return { token, shortcode };
  } catch {
    return null;
  }
}

export function mergeWorkableDetail(
  listing: JobDetails,
  detail: WorkableJobDetail,
): JobDetails {
  // requirements is where the stack is named; keeping only `description` would
  // hand the match a company intro with no technology in it.
  const description = [detail.description, detail.requirements, detail.benefits]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n");

  return {
    ...listing,
    // Untouched: runAtsRun matches the hydrated job back to its ranked listing
    // by URL.
    url: listing.url,
    description: description || listing.description,
  };
}

async function fetchWorkableDetail(
  listing: JobDetails,
  signal?: AbortSignal,
): Promise<JobDetails | null> {
  const parsed = parseWorkableJobUrl(listing.url);
  if (!parsed) return null;

  const url =
    `${APP_CONSTANTS.WORKABLE_DETAIL_BASE_URL}/${encodeURIComponent(parsed.token)}` +
    `/jobs/${encodeURIComponent(parsed.shortcode)}`;

  const response = await fetch(url, { signal });
  // A posting closed between the two calls 404s; skip it and keep the listing.
  if (!response.ok) return null;

  const detail: WorkableJobDetail = await response.json();
  return mergeWorkableDetail(listing, detail);
}

// Fill in the description for the survivors only.
export async function hydrateWorkableJobs(
  jobs: JobDetails[],
  signal?: AbortSignal,
): Promise<JobDetails[]> {
  const limit = pLimit(APP_CONSTANTS.WORKABLE_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    jobs.map((job) => limit(() => fetchWorkableDetail(job, signal))),
  );

  return settled
    .filter(
      (result): result is PromiseFulfilledResult<JobDetails | null> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .filter((job): job is JobDetails => job !== null);
}
