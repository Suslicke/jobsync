import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "../types";
import type { SearchOutcome } from "../ats/types";
import { delay, runDeadline } from "../utils";
import { linkedInPacer } from "./pace";
import {
  guestSearchUrl,
  jobIdFromUrl,
  pageStart,
  parseGuestCards,
  parseJobPosting,
  type LinkedInCard,
} from "./parse";

// LinkedIn's guest job search. No login, no cookie, no profile-view quota — the
// same fragment the logged-out web page renders, fetched directly.
//
// Two endpoints: seeMoreJobPostings/search returns cards with no body text at
// all, and jobPosting/<id> returns the description for one posting. That split
// is why this board has a hydrate(): a sweep can see two thousand cards and
// must only pay for the descriptions of the ones it is going to keep.

// The endpoint answers a bare fetch with no headers at all (checked
// 19.09.2026), so neither of these is load-bearing. They are sent because the
// fragment is region-localised and every downstream check — role fit, language,
// ranking — reads the title as English text.
const GUEST_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

// A 429 on a description is worth re-asking for, because the pacer widens its
// interval on every one and the posting itself is still there. Three tries at
// the AIMD ceiling is about twenty seconds spent on one listing, which is the
// point where dropping it costs less than the queue behind it.
const DESC_MAX_ATTEMPTS = 3;

async function fetchGuest(
  url: string,
  signal?: AbortSignal,
): Promise<{ status: number; html: string }> {
  const deadline = runDeadline(APP_CONSTANTS.LINKEDIN_FETCH_TIMEOUT_MS, signal);
  try {
    const res = await fetch(url, {
      headers: GUEST_HEADERS,
      signal: deadline.signal,
    });
    return { status: res.status, html: res.status === 200 ? await res.text() : "" };
  } finally {
    deadline.release();
  }
}

// Walks one keyword x geography pair, adding what it finds to the run-wide
// `found` map. Returns null when the pair was answered, or the reason it
// produced nothing at all — only a failure on the FIRST page earns a reason,
// because a pair that got three pages and then stopped did not fail.
async function runQuery(
  keyword: string,
  geo: string,
  found: Map<string, LinkedInCard>,
  signal?: AbortSignal,
): Promise<string | null> {
  for (let page = 0; page < APP_CONSTANTS.LINKEDIN_GUEST_MAX_PAGES; page++) {
    // The one place a cancel can land. This board is the reason search() takes
    // a signal at all: 24 pairs of up to 40 pages behind a 700 ms pacer floor is
    // a walk of several minutes, and until this check existed a user's Cancel
    // flipped the run row to 'cancelling' and then watched the process keep
    // asking LinkedIn for pages until the whole sweep finished.
    if (signal?.aborted) return null;

    const start = pageStart(page);
    await linkedInPacer.take();

    let res: { status: number; html: string };
    try {
      res = await fetchGuest(guestSearchUrl(keyword, geo, start), signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return start === 0 ? message : null;
    }

    // 429 means "slow down", not "there is nothing more". Both answers reach
    // this code as a page with no cards on it, and reading this one as the end
    // of the list truncates the query silently — the same shape of mistake as
    // reading a challenge page as an empty result set. The two are told apart
    // by the status, and they are handled oppositely: this one is waited out,
    // an empty 200 is walked away from.
    if (res.status === 429) {
      linkedInPacer.penalise();
      return start === 0 ? "rate limited" : null;
    }
    if (res.status !== 200) {
      return start === 0 ? `returned ${res.status}` : null;
    }
    linkedInPacer.recover();

    const cards = parseGuestCards(res.html);
    if (cards.length === 0) return null;

    let fresh = 0;
    for (const card of cards) {
      if (found.has(card.id)) continue;
      found.set(card.id, card);
      fresh++;
    }
    // A page that adds nothing new is how this endpoint answers a walk past the
    // end of a result set: it serves the same cards again rather than an empty
    // page. The map is run-wide, so a pair that only repeats an earlier pair's
    // results also stops here on its first page — which is correct, because
    // LinkedIn already told us they are the same search.
    if (fresh === 0) return null;
  }
  return null;
}

function toJobDetails(card: LinkedInCard): JobDetails {
  return {
    title: card.title,
    company: card.company,
    location: card.location,
    // The search card carries no body whatsoever. Empty rather than a
    // placeholder: hydrate() is what fills it, and invented text would be
    // ranked and LLM-matched as if it were the posting's own words.
    description: "",
    url: card.url,
    postedDate: card.postedDate || undefined,
  };
}

export async function searchLinkedInJobs(
  config: {
    queries: string[];
    geos: string[];
  },
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const found = new Map<string, LinkedInCard>();
  const pairs = config.queries.flatMap((keyword) =>
    config.geos.map((geo) => ({ keyword, geo })),
  );
  const limit = pLimit(APP_CONSTANTS.LINKEDIN_GUEST_CONCURRENCY);

  const failed: { keyword: string; geo: string; reason: string }[] = [];
  await Promise.all(
    pairs.map((pair) =>
      limit(async () => {
        const reason = await runQuery(pair.keyword, pair.geo, found, signal);
        if (reason) failed.push({ ...pair, reason });
      }),
    ),
  );

  // A pair throttled on its first page contributed nothing, and nothing is
  // exactly what "this search has no matches" looks like in the result. They
  // get one retry once the bucket has had time to refill; whatever still will
  // not answer is reported as a failed unit, by name, instead of being left to
  // read as an empty search.
  const throttled = failed.filter((f) => f.reason === "rate limited");
  const errors = failed
    .filter((f) => f.reason !== "rate limited")
    .map((f) => ({ token: `${f.keyword} in ${f.geo}`, reason: f.reason }));

  // Guarded, not just entered: the retry opens with a full minute of sleeping
  // and then re-walks every throttled pair in sequence. On a cancelled run that
  // is the single longest stretch of work left, and all of it is work whose
  // result is about to be thrown away.
  if (throttled.length > 0 && !signal?.aborted) {
    await delay(APP_CONSTANTS.LINKEDIN_GUEST_RETRY_AFTER_MS, signal);
    for (const pair of throttled) {
      if (signal?.aborted) break;
      const reason = await limit(() =>
        runQuery(pair.keyword, pair.geo, found, signal),
      );
      if (reason) {
        errors.push({
          token: `${pair.keyword} in ${pair.geo}`,
          reason: `${reason} (retried once)`,
        });
      }
    }
  }

  const jobs = [...found.values()].map(toJobDetails);
  return {
    jobs,
    errors,
    // The fragment never says how many postings a search has, and the walk is
    // capped at LINKEDIN_GUEST_MAX_PAGES pages per pair besides. `available` is
    // null because the depth is unknown, and unknown is not zero.
    coverage: { fetched: jobs.length, available: null },
  };
}

// Fills in the descriptions the search cards do not carry, one detail fetch per
// job handed in — which the runner calls with the ranked survivors only.
//
// The returned array is allowed to be shorter than the input: a posting
// withdrawn between the sweep and this pass answers 404, and the runner matches
// what comes back by URL rather than by position.
export async function hydrateLinkedInJobs(
  jobs: JobDetails[],
  signal?: AbortSignal,
): Promise<JobDetails[]> {
  const limit = pLimit(APP_CONSTANTS.LINKEDIN_DESC_CONCURRENCY);
  const filled: JobDetails[] = [];

  await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        if (signal?.aborted) return;
        const id = jobIdFromUrl(job.url);
        if (!id) return;

        for (let attempt = 0; attempt < DESC_MAX_ATTEMPTS; attempt++) {
          if (signal?.aborted) return;
          await linkedInPacer.take();
          let res: { status: number; html: string };
          try {
            res = await fetchGuest(
              `${APP_CONSTANTS.LINKEDIN_DESC_BASE_URL}/${id}`,
              signal,
            );
          } catch {
            return;
          }
          // The posting was taken down. Nothing to load and nothing to retry.
          if (res.status === 404 || res.status === 410) return;
          if (res.status === 429) {
            linkedInPacer.penalise();
            continue;
          }
          if (res.status !== 200) return;
          linkedInPacer.recover();

          const detail = parseJobPosting(res.html);
          // Only a fragment that actually yielded a body counts as hydrated.
          // Returning the job with an empty description would overwrite nothing
          // and still be counted in the runner's "loaded full details for N of
          // M" line — which is how the old collector came to report "ok 20"
          // over twenty blank descriptions.
          if (!detail.description) return;
          filled.push({
            ...job,
            description: detail.description,
            employmentType: detail.employmentType || job.employmentType,
          });
          return;
        }
      }),
    ),
  );

  return filled;
}
