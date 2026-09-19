import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "../types";
import type { SearchOutcome } from "../ats/types";
import { flattenHtml } from "../html";
import { delay, loopFailure, runDeadline } from "../utils";

// Jobspresso: POST https://jobspresso.co/wp-admin/admin-ajax.php with
// action=job_manager_get_listings — WP Job Manager behind the scenes, so the
// listings come back as an HTML blob inside JSON rather than as records.
//
// Field names below are copied off a live response (verified 19.09.2026), not
// recalled. `found_jobs` is the one that punishes a guess: it is a BOOLEAN, so
// reading it as the job count yields 1 and a coverage line claiming the whole
// board is one posting.
export interface JobspressoPage {
  found_jobs?: boolean;
  max_num_pages?: number;
  html?: string;
}

// WP Job Manager only accepts the listing query as a form POST; it answers a
// GET with the WordPress admin-ajax 0-body.
export function jobspressoPageBody(page: number): URLSearchParams {
  return new URLSearchParams({
    action: "job_manager_get_listings",
    page: String(page),
    per_page: String(APP_CONSTANTS.JOBSPRESSO_PAGE_LIMIT),
    orderby: "featured",
  });
}

// Each card is one <li id="job_listing-NNN">, and splitting on the lookahead
// rather than on "<li " is load-bearing: a card CONTAINS two more <li> elements
// (its type badge and its date), so the old collector's split gave 309
// fragments for 100 jobs and survived only because the 209 strays happened to
// carry no title or href. A lookahead split also leaves whatever preamble
// precedes the first card in chunk 0 — filtering on the anchor drops it without
// the off-by-one that `.slice(1)` introduces when the blob starts with a card.
function listingCards(html: string): string[] {
  return html
    .split(/(?=<li id="job_listing-)/)
    .filter((chunk) => chunk.startsWith('<li id="job_listing-'));
}

function pick(card: string, pattern: RegExp): string {
  return flattenHtml(card.match(pattern)?.[1] ?? "");
}

export function parseJobspressoListings(html: string): JobDetails[] {
  const jobs: JobDetails[] = [];

  for (const card of listingCards(html)) {
    const url = card.match(/data-href="([^"]+)"/)?.[1] ?? "";
    const title = pick(card, /<h3 class="job_listing-title">([\s\S]*?)<\/h3>/);
    if (!url || !title) continue;

    jobs.push({
      title,
      // From the <strong>, not from the div around it: that div also holds a
      // <span class="job_listing-company-tagline"> blurb, and a capture that
      // runs to the closing </div> yields "Hopper Hopper uses big data to
      // predict flight and hotel prices". Matching on a class CONTAINING
      // "company" is worse still — the first such element on the card is the
      // <img class="company_logo">.
      company: pick(
        card,
        /<div class="job_listing-company">\s*<strong>([\s\S]*?)<\/strong>/,
      ),
      // The visible text of the maps link; every card carries one.
      location: pick(
        card,
        /<div class="job_listing-location[^"]*"[^>]*>([\s\S]*?)<\/div>/,
      ),
      description: "",
      url,
      // From the job_listing_category-* class, not from the visible
      // <li class="job_listing-type"> badge: that badge is a department
      // ("Product", "Engineer", "Sales"), and mapping it would resolve every
      // card to full-time through normalizeJobType's default while throwing
      // away the real contract / part-time / internship signal.
      employmentType:
        card.match(/job_listing_category-([a-z0-9-]+)/)?.[1] ?? undefined,
      // No postedDate on purpose. The card prints "August 28" with no year and
      // the payload carries no timestamp anywhere, so any date built from it is
      // a guess that silently goes a year wrong each January. rank.ts already
      // treats a missing postedDate as no recency signal; a wrong one would
      // instead sort the whole board to the top or the bottom.
      isRemote: true,
    });
  }

  return jobs;
}

export async function searchJobspressoJobs(
  config: {
    maxPages: number;
    // Jobspresso publishes no sponsorship field, and the board table does not
    // mark it visaFilter, so the wizard never renders the toggle here.
    visaSponsorshipOnly?: boolean;
  },
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];

  // The configured page count is a request, not a licence: a hand-edited
  // sourceConfig asking for 5000 pages would be answered at full speed against
  // a free, unauthenticated host.
  const maxPages = Math.min(config.maxPages, APP_CONSTANTS.JOBSPRESSO_MAX_PAGES);

  try {
    for (let page = 1; page <= maxPages; page++) {
      // Checked at the top of the page loop: a 28-page crawl at Crawl-delay 3
      // is 84 seconds of deliberate waiting, and a cancelled run must not spend
      // them.
      if (signal?.aborted) break;

      // A fresh deadline per request, not one for the whole loop as the other
      // feeds use: robots.txt asks Crawl-delay 3, so a full 28-page run spends
      // 84 seconds waiting on purpose and a single 25-second budget would abort
      // every run at page eight and call the board timed out.
      const deadline = runDeadline(
        APP_CONSTANTS.JOBSPRESSO_FETCH_TIMEOUT_MS,
        signal,
      );

      let body: JobspressoPage;
      try {
        const response = await fetch(APP_CONSTANTS.JOBSPRESSO_BASE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: jobspressoPageBody(page),
          signal: deadline.signal,
        });

        if (response.status === 429) {
          errors.push({
            token: "jobspresso",
            reason: `rate limited on page ${page}`,
          });
          break;
        }
        if (!response.ok) {
          errors.push({
            token: "jobspresso",
            reason: `page ${page} returned ${response.status}`,
          });
          break;
        }

        body = await response.json();
      } finally {
        deadline.release();
      }

      // An interstitial, a WordPress error and a page past the end of the board
      // all arrive as a 200 with no cards, and they must be treated oppositely:
      // the first two are failures to report, the last is a clean end of feed.
      // The `html` key is what tells them apart — admin-ajax answers a rejected
      // action with a bare `0` and no such key, and reading that as "the board
      // ran out" would finalize a blocked run as a quiet one.
      if (!body || typeof body.html !== "string") {
        errors.push({
          token: "jobspresso",
          reason: `page ${page} was not a listing page`,
        });
        break;
      }

      const batch = parseJobspressoListings(body.html);
      if (batch.length === 0) break;
      jobs.push(...batch);

      // The response says how many pages exist; stopping on it saves one wasted
      // request-plus-3-second-delay on every run.
      if (
        typeof body.max_num_pages === "number" &&
        page >= body.max_num_pages
      ) {
        break;
      }

      if (page < maxPages) {
        await delay(APP_CONSTANTS.JOBSPRESSO_PAGE_DELAY_MS, signal);
      }
    }
  } catch (error) {
    // Whatever was already fetched is kept and returned alongside the error: a
    // partial crawl of a 28-page board is a shorter run, not a failed one. The
    // runner only calls the board dead when errors arrive with no jobs at all.
    errors.push({
      token: "jobspresso",
      reason: loopFailure(error, jobs.length, signal),
    });
  }

  // `available: null` although max_num_pages is known: that is a count of
  // pages, and pages x per_page is an estimate the last page falsifies. The
  // response states no job total anywhere, and an estimate printed as "of N
  // available" is a measurement nobody made.
  return { jobs, errors, coverage: { fetched: jobs.length, available: null } };
}

// The listing blob carries no ad text at all — only a title, a company, a
// location and a one-line company tagline (checked live 19.09.2026) — so
// without this pass every Jobspresso row is saved with description "", scored
// against its title alone, and stored with an unmeasured fit.
//
// The posting page is plain WordPress HTML: the ad is everything between the
// job_listing-description container and the job-meta sidebar that follows it.
// Bounded by that sibling rather than by a closing tag, because the ad itself
// contains nested divs and a lazy match to the first </div> stops at the first
// paragraph.
export function parseJobspressoDescription(html: string): string {
  const body = html.match(
    /<div class="job_listing-description[^"]*"[^>]*>([\s\S]*?)<div class="job-meta/,
  )?.[1];
  if (!body) return "";
  // The container opens with an <h2>Overview</h2> widget title that is the same
  // word on every posting on the board and says nothing about this job.
  return flattenHtml(body.replace(/<h2[^>]*widget-title[^>]*>[\s\S]*?<\/h2>/, ""));
}

// Fill in the descriptions for the survivors only. Sequential at the crawl
// delay robots.txt asks for: this board publishes Crawl-delay 3 and applies it
// to every path, so a full ATS_LISTING_CAP of survivors is two and a half
// minutes of deliberate waiting. That is affordable once per run against the
// ranked fifty; it would not be against the fifteen hundred the sweep sees.
export async function hydrateJobspressoJobs(
  jobs: JobDetails[],
  signal?: AbortSignal,
): Promise<JobDetails[]> {
  const filled: JobDetails[] = [];

  for (const [index, job] of jobs.entries()) {
    if (signal?.aborted) break;

    const deadline = runDeadline(
      APP_CONSTANTS.JOBSPRESSO_FETCH_TIMEOUT_MS,
      signal,
    );
    try {
      const response = await fetch(job.url, { signal: deadline.signal });
      // A filled posting is taken down between the sweep and this pass; skip it
      // and keep the ranked listing, which the runner matches back by URL.
      if (!response.ok) continue;
      const description = parseJobspressoDescription(await response.text());
      if (!description) continue;
      filled.push({ ...job, description });
    } catch {
      // One dead posting must not cost the rest of the survivors their text.
      continue;
    } finally {
      deadline.release();
    }

    // Between requests only. Waiting after the last one is three seconds every
    // run spends serving a politeness delay to a request it will never make.
    if (index < jobs.length - 1) {
      await delay(APP_CONSTANTS.JOBSPRESSO_PAGE_DELAY_MS, signal);
    }
  }

  return filled;
}
