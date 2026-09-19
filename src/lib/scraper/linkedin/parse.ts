import { APP_CONSTANTS } from "@/lib/constants";
import { flattenHtml } from "../html";

// One card from the guest search fragment. `id` is kept because the card and
// the detail fragment are two different endpoints keyed by the same posting id.
export interface LinkedInCard {
  id: string;
  title: string;
  company: string;
  location: string;
  postedDate: string;
  url: string;
}

// What the detail fragment adds to a card, and nothing more: the fragment also
// carries seniority, job function and industries, and none of them has a field
// on JobDetails to land in.
export interface LinkedInPostingDetail {
  description: string;
  employmentType: string;
}

// Postings published in the last 30 days.
const TPR_LAST_30_DAYS = "r2592000";

// The guest endpoint ACCEPTS f_WT (remote), f_JT (employment type) and f_E
// (seniority) and applies none of them. Re-checked 19.09.2026: the same query
// with and without f_WT=2 returns the identical ten posting ids, in the same
// order. Only f_TPR, the date window, changes the answer, so it is the only
// filter sent and every other narrowing is the pipeline's job downstream.
//
// The same blindness is why two geo buckets that read differently can be one
// query: "canada" and "canada-remote" added 39 cards to 2157 between them and
// spent a request per keyword proving it.
export function guestSearchUrl(
  keyword: string,
  geo: string,
  start: number,
): string {
  const params = new URLSearchParams({
    keywords: keyword,
    location: geo,
    f_TPR: TPR_LAST_30_DAYS,
    start: String(start),
  });
  return `${APP_CONSTANTS.LINKEDIN_GUEST_BASE_URL}?${params}`;
}

// A page is ten cards and the offset moves by exactly ten. An older sweep
// stepped by 25 and never asked for indices 10-24 of any query at all, which
// looks like a thin search rather than a bug. start=1000 is a hard 400 (still
// true 19.09.2026), which is what LINKEDIN_GUEST_MAX_PAGES x
// LINKEDIN_GUEST_PAGE_STEP encodes.
export function pageStart(page: number): number {
  return page * APP_CONSTANTS.LINKEDIN_GUEST_PAGE_STEP;
}

// The detail endpoint is keyed by the numeric posting id, and by the time a job
// reaches hydrate() the id survives only inside its URL. Both shapes the search
// produces end in it: ".../jobs/view/senior-backend-at-acme-4390721897" and the
// bare ".../jobs/view/4390721897".
export function jobIdFromUrl(url: string): string | null {
  return url.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)/)?.[1] ?? null;
}

// Parsed with regexes over class names rather than a DOM: the response is an
// HTML fragment (a bare run of <li> elements, no document around it), the
// anchors are stable, and the server has no parser to hand it to anyway.
export function parseGuestCards(html: string): LinkedInCard[] {
  const cards: LinkedInCard[] = [];
  for (const chunk of String(html).split(/<li>/i).slice(1)) {
    const id = chunk.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/)?.[1];
    if (!id) continue;
    const pick = (re: RegExp): string => {
      const m = chunk.match(re);
      return m ? flattenHtml(m[1]) : "";
    };
    // A card with no title is not a posting: the same <li> shape is used for
    // the "see more jobs" filler at the end of a short result set.
    const title = pick(/base-search-card__title"[^>]*>\s*([^<]+)/);
    if (!title) continue;
    cards.push({
      id,
      title,
      company: pick(
        /base-search-card__subtitle"[^>]*>\s*(?:<a[^>]*>)?\s*([^<]+)/,
      ),
      location: pick(/job-search-card__location"[^>]*>\s*([^<]+)/),
      postedDate: chunk.match(/datetime="([^"]+)"/)?.[1] ?? "",
      // Stops at the first `?`: the href carries position, refId and
      // trackingId, which differ on every fetch, so keeping them would give
      // one posting a new dedup key each run.
      url:
        chunk.match(/href="(https:\/\/[^"]*?\/jobs\/view\/[^"?]+)/)?.[1] ??
        `${APP_CONSTANTS.LINKEDIN_JOB_URL}/${id}`,
    });
  }
  return cards;
}

// Every field name here was read off a live response, not remembered. The first
// version of the old collector took `description` and `employmentType` from the
// detail payload, which has neither — they are `desc` and `employment` — and so
// wrote twenty empty descriptions over twenty cards and reported "ok 20". A
// wrong name costs nothing at the call site and everything in the data.
export function parseJobPosting(html: string): LinkedInPostingDetail {
  // The body is the .show-more-less-html__markup block. LinkedIn puts only
  // <p>/<ul>/<strong> inside it and never a nested <div>, so the first </div>
  // closes exactly that block.
  const markup =
    html.match(
      /class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    )?.[1] ?? "";

  // Seniority level / Employment type / Job function / Industries arrive as
  // <h3>+<span> pairs, and postings routinely ship only some of them. The label
  // is read from the heading text, never from the pair's position, or a posting
  // missing "Seniority level" files its employment type under that name.
  const criteria = new Map<string, string>();
  const re =
    /<h3[^>]*description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/gi;
  for (const m of html.matchAll(re)) {
    criteria.set(flattenHtml(m[1]), flattenHtml(m[2]));
  }

  return {
    // Stored as markup, like every other board's description: the fragment is
    // already real HTML, so it is trimmed rather than entity-decoded.
    description: markup.trim(),
    employmentType: criteria.get("Employment type") ?? "",
  };
}
