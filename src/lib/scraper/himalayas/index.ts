import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "../types";
import type { SearchOutcome } from "../ats/types";
import { decodeHtml } from "../html";
import { delay, loopFailure, runDeadline } from "../utils";

// Himalayas: GET https://himalayas.app/jobs/api?limit=100&cursor=<nextCursor> —
// cursor pagination over a ~102k-deep feed, no key and no login.
//
// Field names below are copied off a live response (verified 19.09.2026), not
// recalled: the old panel's first lidesc pass read `p.description` and
// `p.employmentType` on a payload that spells them `desc` and `employment`,
// wrote twenty empty descriptions and reported "ok 20". A wrong name here is
// silent in exactly the same way — `undefined ?? ""` is a valid empty string.
export interface HimalayasJob {
  title?: string;
  excerpt?: string;
  companyName?: string;
  companySlug?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string | null;
  currency?: string | null;
  locationRestrictions?: string[];
  description?: string;
  // Unix SECONDS, not milliseconds and not a date string.
  pubDate?: number;
  applicationLink?: string;
  guid?: string;
}

export interface HimalayasPage {
  jobs?: HimalayasJob[];
  nextCursor?: string;
  // The feed's full depth (~102k). Absent on a page that is not a job page.
  totalCount?: number;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

// Himalayas is the only board in the pool that publishes a pay range on the
// list endpoint. match.ts puts JobDetails.salary in the LLM prompt, so it is
// worth the six lines. min and max are read separately rather than filtered
// into an array: with only maxSalary set, a filtered array would print the
// ceiling where a reader sees the floor.
function himalayasSalary(job: HimalayasJob): string | undefined {
  const min = positive(job.minSalary);
  const max = positive(job.maxSalary);
  if (min === null && max === null) return undefined;
  const amount =
    min !== null && max !== null && min !== max
      ? `${min}-${max}`
      : String(min ?? max);
  return [amount, job.currency, job.salaryPeriod].filter(Boolean).join(" ");
}

export function mapHimalayasJob(job: HimalayasJob): JobDetails {
  // An empty locationRestrictions is the feed saying "hire from anywhere", not
  // a field the employer left blank — which is the one thing this board is
  // collected for. "Remote" is the honest rendering of that; an empty string
  // would read as unknown and the strict-location gate would drop the row.
  const restrictions = (job.locationRestrictions ?? []).filter(Boolean);

  return {
    title: (job.title ?? "").trim(),
    company: job.companyName || job.companySlug || "",
    location: restrictions.join(", ") || "Remote",
    description: decodeHtml(job.description || job.excerpt || ""),
    url: job.applicationLink || job.guid || "",
    // pubDate is Unix seconds. new Date(1789775053) is 21 January 1970, and
    // rank.ts's recencyTiebreak would then rank every Himalayas row below
    // every row from every other board, forever.
    postedDate:
      typeof job.pubDate === "number"
        ? new Date(job.pubDate * 1000).toISOString()
        : undefined,
    employmentType: job.employmentType,
    salary: himalayasSalary(job),
    // A remote-only board: every posting on it is remote by definition.
    isRemote: true,
  };
}

export function himalayasPageUrl(cursor?: string): string {
  const params = new URLSearchParams({
    limit: String(APP_CONSTANTS.HIMALAYAS_PAGE_LIMIT),
  });
  if (cursor) params.set("cursor", cursor);
  return `${APP_CONSTANTS.HIMALAYAS_BASE_URL}?${params}`;
}

export async function searchHimalayasJobs(
  config: {
    maxPages: number;
    // Himalayas has no sponsorship filter and the board table does not mark it
    // visaFilter, so the wizard never renders the toggle for this board. The
    // field belongs to the shared feed config, not to this feed.
    visaSponsorshipOnly?: boolean;
  },
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  // One deadline for the whole loop, plus the run's own cancel.
  const deadline = runDeadline(
    APP_CONSTANTS.HIMALAYAS_FETCH_TIMEOUT_MS,
    signal,
  );

  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];
  // Unknown depth is null, never 0: a run that never saw totalCount has not
  // measured the feed, and "0 available" next to "200 fetched" is a lie.
  let available: number | null = null;

  // The configured page count is a request, not a licence. These feeds are
  // free, public and unauthenticated, and Arbeitnow's own response asks
  // callers not to abuse them; a hand-edited sourceConfig asking for 5000
  // pages would be answered at full speed until the shared IP is blocked.
  const maxPages = Math.min(config.maxPages, APP_CONSTANTS.HIMALAYAS_MAX_PAGES);

  try {
    let cursor = "";
    for (let page = 0; page < maxPages; page++) {
      // Checked at the top of the page loop, not only around the fetch: a
      // cancelled run must stop asking on the next page rather than when the
      // whole walk finishes.
      if (signal?.aborted) break;

      const response = await fetch(himalayasPageUrl(cursor), {
        signal: deadline.signal,
      });

      if (!response.ok) {
        errors.push({
          token: "himalayas",
          reason: `page ${page + 1} returned ${response.status}`,
        });
        break;
      }

      const body: HimalayasPage = await response.json();

      // A 200 that is not a job page and a job page with nothing left on it
      // look equally empty and must be treated oppositely: the first is a
      // failure to report, the second is a clean end of feed. `jobs` being an
      // array is what tells them apart — an interstitial or a maintenance
      // page has no such key, and reading it as "the feed is exhausted" would
      // finalize a blocked run as a quiet one.
      if (!body || !Array.isArray(body.jobs)) {
        errors.push({
          token: "himalayas",
          reason: `page ${page + 1} was not a job page`,
        });
        break;
      }

      // Kept from the first page that carries it: it is the depth at the
      // moment the run started, and the feed's count moves between requests.
      if (available === null && typeof body.totalCount === "number") {
        available = body.totalCount;
      }

      if (body.jobs.length === 0) break;
      jobs.push(...body.jobs.map(mapHimalayasJob));

      // Pagination is driven by nextCursor and by nothing else. `limit=100` is
      // sent and ignored — the response echoes `limit: 20` whatever is asked —
      // so the usual "a page shorter than the limit is the last page" rule
      // would stop this feed after twenty rows out of a hundred thousand.
      const next = typeof body.nextCursor === "string" ? body.nextCursor : "";
      // A repeated cursor means the feed is not advancing; without this the
      // loop refetches the same twenty rows up to HIMALAYAS_MAX_PAGES.
      if (!next || next === cursor) break;
      cursor = next;

      await delay(APP_CONSTANTS.HIMALAYAS_PAGE_DELAY_MS, signal);
    }
  } catch (error) {
    // Whatever was already fetched is kept and returned alongside the error:
    // a fresh top is this board's normal result, so a page-six timeout is a
    // shorter run, not a failed one. The runner only calls the board dead
    // when errors arrive with no jobs at all.
    errors.push({
      token: "himalayas",
      reason: loopFailure(error, jobs.length, signal),
    });
  } finally {
    deadline.release();
  }

  return { jobs, errors, coverage: { fetched: jobs.length, available } };
}
