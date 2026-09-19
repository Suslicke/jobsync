import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { AtsCompany } from "@/models/automation.model";
import type { JobDetails, ScraperResult } from "../types";
import type { ResolveResult, SearchOutcome } from "../ats/types";
import {
  ATS_TOKEN_MIXED_REGEX,
  boardSlugFrom,
  delay,
  errorReason,
  humanizeToken,
  runDeadline,
} from "../utils";

// SmartRecruiters' public postings API: GET /v1/companies/<slug>/postings.
// Offset pagination against a totalFound the adapter reports as coverage.
//
// Verified live 19.09.2026 against the `Mirantis` board: 93 postings,
// totalFound 93, and offset=100 returning an empty page rather than an error.

interface SmartRecruitersPosting {
  id: string;
  // The title is `name`; there is no `title` field.
  name?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
    hybrid?: boolean;
    fullLocation?: string;
  } | null;
  typeOfEmployment?: { id?: string; label?: string } | null;
  releasedDate?: string;
}

interface SmartRecruitersListResponse {
  offset?: number;
  limit?: number;
  // The board's real depth, which is what makes "fetched 50" readable.
  totalFound?: number;
  content?: SmartRecruitersPosting[];
}

interface SmartRecruitersJobAdSection {
  title?: string;
  text?: string;
}

interface SmartRecruitersPostingDetail {
  jobAd?: {
    sections?: {
      companyDescription?: SmartRecruitersJobAdSection;
      jobDescription?: SmartRecruitersJobAdSection;
      qualifications?: SmartRecruitersJobAdSection;
      additionalInformation?: SmartRecruitersJobAdSection;
    };
  };
}

// The location booleans are on every posting, so both-false is a measurement
// ("neither remote nor hybrid" = on-site) rather than an absence. A posting
// with no location object at all stays unmeasured.
function mapSmartRecruitersWorkplace(
  location: SmartRecruitersPosting["location"],
): string | undefined {
  if (!location) return undefined;
  if (location.remote) return "REMOTE";
  if (location.hybrid) return "HYBRID";
  if (
    typeof location.remote === "boolean" &&
    typeof location.hybrid === "boolean"
  ) {
    return "ONSITE";
  }
  return undefined;
}

function locationLabel(posting: SmartRecruitersPosting): string {
  // fullLocation spells the country out ("Barcelona, CT, Spain"); the compact
  // `country` field is a two-letter code in lower case ("us"), which is not how
  // anyone writes a location filter.
  const full = posting.location?.fullLocation?.trim();
  if (full) return full;
  return [posting.location?.city, posting.location?.country]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

export function smartRecruitersJobUrl(token: string, id: string): string {
  return `${APP_CONSTANTS.SMARTRECRUITERS_BOARD_URL}/${token}/${id}`;
}

export function mapSmartRecruitersPosting(
  posting: SmartRecruitersPosting,
  companyName: string,
  token: string,
): JobDetails {
  return {
    title: (posting.name ?? "").trim(),
    // The payload's company.name repeats the slug's casing rather than the
    // employer's own spelling, so the watchlist entry wins — the same rule the
    // other company boards follow.
    company: companyName,
    location: locationLabel(posting),
    // The list carries no ad text at all; hydrateSmartRecruitersJobs fills the
    // survivors from the per-posting detail.
    description: "",
    url: smartRecruitersJobUrl(token, posting.id),
    postedDate: posting.releasedDate,
    // Here `label` is the human string ("Full-time") and `id` the enum
    // ("permanent") — the opposite of Rippling's pair, which is why neither
    // board's mapping can be reused for the other.
    employmentType: posting.typeOfEmployment?.label,
    workplaceType: mapSmartRecruitersWorkplace(posting.location),
  };
}

// Fetch one board, page by page. `limit` is capped at 100 by the API: asking
// for 200 answers with limit=100, so the constant is the ceiling and not a
// preference.
export async function fetchSmartRecruitersBoardJobs(
  name: string,
  token: string,
  signal?: AbortSignal,
): Promise<ScraperResult<{ jobs: JobDetails[]; total: number | null }>> {
  // One deadline for the whole loop, plus the run's own cancel.
  const deadline = runDeadline(
    APP_CONSTANTS.SMARTRECRUITERS_FETCH_TIMEOUT_MS,
    signal,
  );

  try {
    const all: JobDetails[] = [];
    let total: number | null = null;

    for (let page = 0; page < APP_CONSTANTS.SMARTRECRUITERS_MAX_PAGES; page++) {
      const offset = page * APP_CONSTANTS.SMARTRECRUITERS_PAGE_LIMIT;
      const url =
        `${APP_CONSTANTS.SMARTRECRUITERS_BASE_URL}/${encodeURIComponent(token)}/postings` +
        `?limit=${APP_CONSTANTS.SMARTRECRUITERS_PAGE_LIMIT}&offset=${offset}`;

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

      const data: SmartRecruitersListResponse = await response.json();
      if (!Array.isArray(data.content)) {
        return {
          success: false,
          error: { type: "parse", message: `Board '${token}' malformed page` },
        };
      }

      if (typeof data.totalFound === "number") total = data.totalFound;
      all.push(
        ...data.content.map((posting) =>
          mapSmartRecruitersPosting(posting, name, token),
        ),
      );

      // Past the end the API answers 200 with an empty page, so a short page is
      // the only end-of-board signal there is.
      if (data.content.length < APP_CONSTANTS.SMARTRECRUITERS_PAGE_LIMIT) break;

      await delay(APP_CONSTANTS.SMARTRECRUITERS_PAGE_DELAY_MS, signal);
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
export async function searchSmartRecruitersJobs(
  companies: AtsCompany[],
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const limit = pLimit(APP_CONSTANTS.SMARTRECRUITERS_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    companies.map(({ name, token }) =>
      limit(() => fetchSmartRecruitersBoardJobs(name, token, signal)),
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
        // A board that failed leaves the depth unknown rather than adding zero:
        // an unmeasured total must not read as "nothing left to fetch".
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

// Board slug out of a pasted jobs.smartrecruiters.com link (board page or deep
// posting link) or a bare slug, probed live. The wizard has always offered that
// link, and without this the save boundary tested the whole URL against the
// token allowlist and answered "Paste a SmartRecruiters board token".
//
// Slugs are capitalised here ('Mirantis'), which is why the mixed-case
// allowlist is the one applied and why the URL capture is not lowercased. The
// API itself is case-insensitive (verified live 19.09.2026), but the stored
// token is also what smartRecruitersJobUrl writes into every posting link.
export async function resolveSmartRecruitersBoard(
  input: string,
): Promise<ResolveResult> {
  const token = boardSlugFrom(
    input,
    /jobs\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i,
  );
  if (!token || !ATS_TOKEN_MIXED_REGEX.test(token)) {
    return {
      success: false,
      message: "Paste a jobs.smartrecruiters.com link or a board token",
    };
  }

  try {
    const res = await fetch(
      `${APP_CONSTANTS.SMARTRECRUITERS_BASE_URL}/${encodeURIComponent(token)}` +
        `/postings?limit=1`,
    );
    if (!res.ok) {
      return {
        success: false,
        message: `Could not validate board (${res.status})`,
      };
    }

    // There is nothing here that proves a board does NOT exist: an unknown slug
    // answers 200 with totalFound 0, exactly like a real company with nothing
    // open, and there is no /v1/companies/<slug> to ask instead — that path
    // 404s for every slug, real or not (both checked live 19.09.2026). So a
    // typo is accepted and shows up later as a watched board that never yields
    // anything; refusing it would mean refusing every employer between
    // vacancies, which is the more common case by far.
    const body: { content?: { company?: { name?: string } }[] } =
      await res.json();
    const name = body.content?.[0]?.company?.name?.trim();
    return { success: true, name: name || humanizeToken(token), token };
  } catch {
    return { success: false, message: "Could not reach SmartRecruiters" };
  }
}

// The stored posting URL is the only handle hydrate gets back. The list also
// hands out a `ref` pointing straight at the detail, but it does not survive
// ranking, so the slug and id are parsed out of the URL again.
export function parseSmartRecruitersJobUrl(
  url: string,
): { token: string; id: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "jobs.smartrecruiters.com") {
      return null;
    }
    const [token, id] = parsed.pathname
      .replace(/^\//, "")
      .split("/")
      .filter(Boolean);
    if (!token || !id) return null;
    return { token, id };
  } catch {
    return null;
  }
}

export function mergeSmartRecruitersDetail(
  listing: JobDetails,
  detail: SmartRecruitersPostingDetail,
): JobDetails {
  const sections = detail.jobAd?.sections;
  // Fixed order, because the object's key order is not the reading order of the
  // ad. Only the section bodies are kept: the four titles are the same
  // boilerplate on every SmartRecruiters posting and say nothing about this job.
  const description = [
    sections?.companyDescription?.text,
    sections?.jobDescription?.text,
    sections?.qualifications?.text,
    sections?.additionalInformation?.text,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n");

  return {
    ...listing,
    // Untouched: runAtsRun matches the hydrated job back to its ranked listing
    // by URL, and the detail's own postingUrl differs from the list's — it
    // carries the title slug.
    url: listing.url,
    description: description || listing.description,
  };
}

async function fetchSmartRecruitersDetail(
  listing: JobDetails,
  signal?: AbortSignal,
): Promise<JobDetails | null> {
  const parsed = parseSmartRecruitersJobUrl(listing.url);
  if (!parsed) return null;

  const url =
    `${APP_CONSTANTS.SMARTRECRUITERS_BASE_URL}/${encodeURIComponent(parsed.token)}` +
    `/postings/${encodeURIComponent(parsed.id)}`;

  const response = await fetch(url, { signal });
  // A posting closed between the two calls 404s; skip it and keep the listing.
  if (!response.ok) return null;

  const detail: SmartRecruitersPostingDetail = await response.json();
  return mergeSmartRecruitersDetail(listing, detail);
}

// Fill in the ad text for the survivors only.
export async function hydrateSmartRecruitersJobs(
  jobs: JobDetails[],
  signal?: AbortSignal,
): Promise<JobDetails[]> {
  const limit = pLimit(APP_CONSTANTS.SMARTRECRUITERS_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    jobs.map((job) => limit(() => fetchSmartRecruitersDetail(job, signal))),
  );

  return settled
    .filter(
      (result): result is PromiseFulfilledResult<JobDetails | null> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .filter((job): job is JobDetails => job !== null);
}
