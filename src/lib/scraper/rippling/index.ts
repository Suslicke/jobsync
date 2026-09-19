import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { AtsCompany } from "@/models/automation.model";
import type { JobDetails, ScraperResult } from "../types";
import type { ResolveResult, SearchOutcome } from "../ats/types";
import {
  ATS_TOKEN_REGEX,
  boardSlugFrom,
  errorReason,
  humanizeToken,
  runDeadline,
} from "../utils";

// Rippling's public company board: GET /board/<slug>/jobs answers a BARE JSON
// array (no envelope, no total), and every posting the board holds is in it —
// there is no pagination to do.
//
// Verified live 19.09.2026 against the `chess` board (13 postings).

// What the LIST actually carries, checked field by field against a live
// response rather than copied from the old collector, which asked for
// `description`, `employmentType`, `workplaceType` and `createdAt` here and got
// undefined for all four — the same shape of bug as lidesc reading
// `p.description` when the field was `desc` and reporting "ok 20" over twenty
// empty texts.
interface RipplingListJob {
  uuid: string;
  name?: string;
  url?: string;
  department?: { id?: string; label?: string } | null;
  // Singular on the list, PLURAL and a plain string array on the detail.
  workLocation?: { id?: string; label?: string } | null;
}

interface RipplingJobDetail {
  uuid?: string;
  name?: string;
  // Not a string: two HTML halves. `company` is the boilerplate about the
  // employer and `role` holds the actual requirements, so reading only the
  // first is the Lever descriptionPlain mistake — an intro with no stack in it,
  // and a match percentage measured against nothing.
  description?: { company?: string; role?: string } | null;
  workLocations?: string[];
  // label/id read backwards here: `label` is the enum ("SALARIED_FT") and `id`
  // is the human string ("Salaried, full-time"). On the list's `department` and
  // `workLocation` the two fields hold the same text, so the pair gives no hint
  // — this one was read off a live posting.
  employmentType?: { id?: string; label?: string } | null;
  // Not `createdAt`.
  createdOn?: string;
  companyName?: string;
}

export function mapRipplingListJob(
  job: RipplingListJob,
  companyName: string,
  token: string,
): JobDetails {
  return {
    title: (job.name ?? "").trim(),
    // Only the detail carries `companyName`; the list does not, so it comes
    // from the watchlist entry as it does for Lever and Ashby.
    company: companyName,
    location: (job.workLocation?.label ?? "").trim(),
    // Empty, not a placeholder: the list has no description field at all, and
    // hydrateRipplingJobs fills it for the survivors only. A board of 200 cards
    // must cost a detail request per job that will be saved, not per job seen.
    description: "",
    url:
      job.url ||
      `${APP_CONSTANTS.RIPPLING_BOARD_URL}/${token}/jobs/${job.uuid}`,
  };
}

// Fetch one board. The whole board arrives in a single response.
export async function fetchRipplingBoardJobs(
  name: string,
  token: string,
  signal?: AbortSignal,
): Promise<ScraperResult<JobDetails[]>> {
  const deadline = runDeadline(
    APP_CONSTANTS.RIPPLING_FETCH_TIMEOUT_MS,
    signal,
  );

  try {
    const url = `${APP_CONSTANTS.RIPPLING_BASE_URL}/${encodeURIComponent(
      token,
    )}/jobs`;
    const response = await fetch(url, { signal: deadline.signal });

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

    const data: unknown = await response.json();
    // A bare array is the success shape. Anything else (an error envelope, a
    // login page) must be an error and not an empty board: a wrong slug that
    // reports "0 jobs" looks exactly like a board with nothing open.
    if (!Array.isArray(data)) {
      return {
        success: false,
        error: { type: "parse", message: `Board '${token}' malformed payload` },
      };
    }

    const jobs = (data as RipplingListJob[]).map((job) =>
      mapRipplingListJob(job, name, token),
    );
    return { success: true, data: jobs };
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

// Fetch a watchlist in parallel (bounded concurrency) with per-token isolation,
// so one dead board costs its own postings and not the run.
export async function searchRipplingJobs(
  companies: AtsCompany[],
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const limit = pLimit(APP_CONSTANTS.RIPPLING_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    companies.map(({ name, token }) =>
      limit(() => fetchRipplingBoardJobs(name, token, signal)),
    ),
  );

  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];

  settled.forEach((result, index) => {
    const token = companies[index].token;
    if (result.status === "fulfilled") {
      if (result.value.success) {
        jobs.push(...result.value.data);
      } else {
        errors.push({ token, reason: errorReason(result.value.error) });
      }
    } else {
      const reason =
        result.reason instanceof Error ? result.reason.message : "Unknown error";
      errors.push({ token, reason });
    }
  });

  return { jobs, errors };
}

// Board slug out of a pasted ats.rippling.com link (board page or deep posting
// link) or a bare slug, probed live. The wizard's own copy has always said "or
// paste an ats.rippling.com link or token", and without this the save boundary
// tested that whole string against ATS_TOKEN_REGEX and answered "Paste a
// Rippling board token" to the exact thing the user had just pasted.
export async function resolveRipplingBoard(
  input: string,
): Promise<ResolveResult> {
  const slug = boardSlugFrom(input, /ats\.rippling\.com\/([a-z0-9_-]+)/i);
  const token = slug?.toLowerCase();
  if (!token || !ATS_TOKEN_REGEX.test(token)) {
    return {
      success: false,
      message: "Paste an ats.rippling.com link or a board token",
    };
  }

  try {
    const res = await fetch(
      `${APP_CONSTANTS.RIPPLING_BASE_URL}/${encodeURIComponent(token)}/jobs`,
    );
    if (res.status === 404) {
      return { success: false, message: `No Rippling board found for '${token}'` };
    }
    if (!res.ok) {
      return {
        success: false,
        message: `Could not validate board (${res.status})`,
      };
    }

    const data: unknown = await res.json();
    if (!Array.isArray(data)) {
      return { success: false, message: `'${token}' is not a Rippling board` };
    }

    // The employer's own spelling lives on the DETAIL and nowhere on the list,
    // so one open posting is borrowed to read it. Worth the second request at
    // wizard time: humanizeToken('chess') is "Chess", and the board belongs to
    // Chess.com.
    const first = (data as RipplingListJob[])[0];
    const url = first?.url;
    if (url) {
      const parsed = parseRipplingJobUrl(url);
      if (parsed) {
        const detailRes = await fetch(
          `${APP_CONSTANTS.RIPPLING_BASE_URL}/${encodeURIComponent(parsed.token)}` +
            `/jobs/${encodeURIComponent(parsed.uuid)}`,
        );
        if (detailRes.ok) {
          const detail: RipplingJobDetail = await detailRes.json();
          const name = detail.companyName?.trim();
          if (name) return { success: true, name, token };
        }
      }
    }

    return { success: true, name: humanizeToken(token), token };
  } catch {
    return { success: false, message: "Could not reach Rippling" };
  }
}

// The stored posting URL is the only handle hydrate gets back — the survivors
// arrive as JobDetails, with no room for the slug and uuid the detail endpoint
// needs — so it is parsed out again rather than carried in a side map that
// would have to survive ranking.
export function parseRipplingJobUrl(
  url: string,
): { token: string; uuid: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "ats.rippling.com") return null;
    const [token, jobs, uuid] = parsed.pathname.replace(/^\//, "").split("/");
    if (!token || jobs !== "jobs" || !uuid) return null;
    return { token, uuid };
  } catch {
    return null;
  }
}

export function mergeRipplingDetail(
  listing: JobDetails,
  detail: RipplingJobDetail,
): JobDetails {
  const description = [detail.description?.company, detail.description?.role]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n");

  const locations = (detail.workLocations ?? [])
    .map((entry) => entry?.trim())
    .filter(Boolean);

  return {
    ...listing,
    // The URL must survive untouched: runAtsRun matches the hydrated job back
    // to its ranked listing by URL, and a rewritten one silently drops the
    // description it just paid for.
    url: listing.url,
    company: detail.companyName?.trim() || listing.company,
    location: locations.length > 0 ? locations.join(", ") : listing.location,
    description: description || listing.description,
    postedDate: detail.createdOn || listing.postedDate,
    // The human string, which lives in `id`. normalizeJobType folds it to FT,
    // the same answer as for a board that says nothing.
    employmentType: detail.employmentType?.id || listing.employmentType,
  };
}

async function fetchRipplingDetail(
  listing: JobDetails,
  signal?: AbortSignal,
): Promise<JobDetails | null> {
  const parsed = parseRipplingJobUrl(listing.url);
  if (!parsed) return null;

  const url = `${APP_CONSTANTS.RIPPLING_BASE_URL}/${encodeURIComponent(
    parsed.token,
  )}/jobs/${encodeURIComponent(parsed.uuid)}`;

  const response = await fetch(url, { signal });
  // A withdrawn posting 404s between the listing fetch and this one. Skipping
  // it keeps the ranked listing as it was; runAtsRun tolerates a short array.
  if (!response.ok) return null;

  const detail: RipplingJobDetail = await response.json();
  return mergeRipplingDetail(listing, detail);
}

// Fill in what the list endpoint does not carry — description, employment type,
// posted date — for the survivors only.
export async function hydrateRipplingJobs(
  jobs: JobDetails[],
  signal?: AbortSignal,
): Promise<JobDetails[]> {
  const limit = pLimit(APP_CONSTANTS.RIPPLING_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    jobs.map((job) => limit(() => fetchRipplingDetail(job, signal))),
  );

  // One failed detail costs that job's description, never the pass: the
  // listings are already ranked and still worth saving.
  return settled
    .filter(
      (result): result is PromiseFulfilledResult<JobDetails | null> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .filter((job): job is JobDetails => job !== null);
}
