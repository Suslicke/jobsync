import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "../types";
import type { SearchOutcome } from "../ats/types";
import { decodeHtml } from "../html";
import { delay, loopFailure, runDeadline } from "../utils";

// Arbeitnow: GET https://www.arbeitnow.com/api/job-board-api?visa_sponsorship=true&page=N.
//
// `visa_sponsorship=true` is the only server-side sponsorship filter that works
// anywhere in this pool, which is why this is the one board the table marks
// visaFilter. Everywhere else sponsorship is a field employers do not fill in:
// on remote.com a full scan of 290 pages found visa_sponsorship_offered true
// for one posting out of 5794. Here it genuinely narrows the feed — page one
// filtered and page one unfiltered share only 152 of 250 slugs.
//
// Field names below are copied off a live response (verified 19.09.2026), not
// recalled: the old panel's first lidesc pass read `p.description` on a payload
// that spells it `desc`, wrote twenty empty descriptions and reported "ok 20".
export interface ArbeitnowJob {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  // Unix SECONDS, not milliseconds and not a date string.
  created_at?: number;
}

export interface ArbeitnowPage {
  data?: ArbeitnowJob[];
  // `next` is null on the last page; `last` is null always, so the feed's
  // depth is never stated.
  links?: { next?: string | null };
}

export function mapArbeitnowJob(job: ArbeitnowJob): JobDetails {
  return {
    title: (job.title ?? "").trim(),
    company: job.company_name ?? "",
    location: job.location ?? "",
    description: decodeHtml(job.description ?? ""),
    url: job.url ?? "",
    // created_at is Unix seconds. new Date(1789763409) is 21 January 1970, and
    // rank.ts's recencyTiebreak would then rank every Arbeitnow row below
    // every row from every other board, forever.
    postedDate:
      typeof job.created_at === "number"
        ? new Date(job.created_at * 1000).toISOString()
        : undefined,
    // Joined rather than picked from: job_types mixes seniority and contract
    // ("Mid", "fulltime permanent") with no key saying which is which, and
    // mapper.ts's normalizeJobType already falls back to full-time on anything
    // it does not recognise. Guessing one of them is the employment type would
    // be inventing a distinction the payload does not make.
    employmentType: (job.job_types ?? []).join(", "),
    isRemote: job.remote === true,
  };
}

export function arbeitnowPageUrl(
  page: number,
  visaSponsorshipOnly: boolean,
): string {
  const params = new URLSearchParams({ page: String(page) });
  if (visaSponsorshipOnly) params.set("visa_sponsorship", "true");
  return `${APP_CONSTANTS.ARBEITNOW_BASE_URL}?${params}`;
}

export async function searchArbeitnowJobs(
  config: {
    maxPages: number;
    visaSponsorshipOnly?: boolean;
  },
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  // One deadline for the whole loop, plus the run's own cancel.
  const deadline = runDeadline(
    APP_CONSTANTS.ARBEITNOW_FETCH_TIMEOUT_MS,
    signal,
  );

  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];

  // The configured page count is a request, not a licence. The response's own
  // meta.terms asks callers not to abuse a free public API, and a hand-edited
  // sourceConfig asking for 5000 pages of 250 rows would be answered at full
  // speed until the shared IP is blocked.
  const maxPages = Math.min(config.maxPages, APP_CONSTANTS.ARBEITNOW_MAX_PAGES);

  // The toggle picks the feed rather than tagging the rows. The old collector
  // fetched the filtered pass AND the plain one only so it could stamp each
  // row `visaSponsorship: true/false`; JobDetails carries no such field and the
  // payload has none either — sponsorship exists here solely as the request
  // parameter — so fetching both would produce an untagged mixture in which
  // the one usable signal in the pool is lost.
  const visaSponsorshipOnly = config.visaSponsorshipOnly === true;

  try {
    for (let page = 1; page <= maxPages; page++) {
      // Checked at the top of the page loop, not only around the fetch: a
      // cancelled run must stop asking on the next page rather than when the
      // whole walk finishes.
      if (signal?.aborted) break;

      const response = await fetch(
        arbeitnowPageUrl(page, visaSponsorshipOnly),
        { signal: deadline.signal },
      );

      if (!response.ok) {
        errors.push({
          token: "arbeitnow",
          reason: `page ${page} returned ${response.status}`,
        });
        break;
      }

      const body: ArbeitnowPage = await response.json();

      // A 200 that is not a job page and a job page with nothing left on it
      // look equally empty and must be treated oppositely: the first is a
      // failure to report, the second is a clean end of feed. `data` being an
      // array is what tells them apart — an interstitial or a maintenance page
      // has no such key, and reading it as "the feed is exhausted" would
      // finalize a blocked run as a quiet one.
      if (!body || !Array.isArray(body.data)) {
        errors.push({
          token: "arbeitnow",
          reason: `page ${page} was not a job page`,
        });
        break;
      }

      if (body.data.length === 0) break;
      jobs.push(...body.data.map(mapArbeitnowJob));

      // links.next answers "is there another page", and that is all it is used
      // for: the URL we fetch is built from our own page number. Following a
      // link out of a response body hands a third party the choice of what
      // this server requests next.
      if (!body.links?.next) break;

      await delay(APP_CONSTANTS.ARBEITNOW_PAGE_DELAY_MS, signal);
    }
  } catch (error) {
    // Whatever was already fetched is kept and returned alongside the error: a
    // page-six timeout is a shorter run, not a failed one. The runner only
    // calls the board dead when errors arrive with no jobs at all.
    errors.push({
      token: "arbeitnow",
      reason: loopFailure(error, jobs.length, signal),
    });
  } finally {
    deadline.release();
  }

  // available is null, not 0: neither `meta` nor `links.last` states a total,
  // so this feed's depth is unmeasured and must not be reported as measured.
  return { jobs, errors, coverage: { fetched: jobs.length, available: null } };
}
