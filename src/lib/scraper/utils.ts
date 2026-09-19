import type { ScraperError } from "./types";
import { canonicalizeEntityValue } from "@/lib/jobs/canonicalize";
import { roleKey } from "@/lib/jobs/roleKey";

// Allowlist for ATS board tokens (shared by every ATS provider). Rejects
// path/query injection before the token is interpolated into a fetch URL.
export const ATS_TOKEN_REGEX = /^[a-z0-9][a-z0-9_-]{1,79}$/;

// Same allowlist, case-preserving. SmartRecruiters slugs are capitalised
// ('Mirantis', 'Acumatica') and the lowercase-only regex above would reject
// every one of them at the save boundary. Which regex a board gets is decided
// by its tokenCase in the board table, never guessed per call site.
export const ATS_TOKEN_MIXED_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/;

// Human-readable reason for a per-board fetch failure. Shared by both ATS
// providers so the runner logs a consistent label.
export function errorReason(error: ScraperError): string {
  switch (error.type) {
    case "blocked":
      return error.reason;
    case "rate_limited":
      return "rate limited";
    case "network":
    case "parse":
      return error.message;
  }
}

// One signal for both ways a fetch has to stop: its own deadline, and the run
// being cancelled. Sixteen adapters wrote the controller/setTimeout/clearTimeout
// trio by hand and not one of them could see the run's signal, because search()
// did not take one — the runner's first `aborted` check came after search()
// returned. A user who cancelled a LinkedIn sweep two minutes in watched the run
// row flip to 'cancelling' while the process kept asking LinkedIn for pages for
// another twenty-six minutes.
//
// Built from a controller rather than AbortSignal.any(AbortSignal.timeout(...)):
// a timeout signal aborts with a TimeoutError, and every adapter here reads
// `name === "AbortError"` to decide whether a failure was its own deadline.
export function runDeadline(
  timeoutMs: number,
  signal?: AbortSignal,
): { signal: AbortSignal; release(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort);
  }
  return {
    signal: controller.signal,
    // Removing the listener matters: the run signal outlives every request made
    // under it, so a 40-page walk that only cleared its timer would leave forty
    // dead listeners attached to it.
    release() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

// The politeness pause between two requests to the same host. Nine adapters
// wrote this line for themselves, and every one of them slept through a cancel:
// Jobspresso alone owes robots.txt three seconds per page, so a cancelled crawl
// served out the delay for a page it was never going to fetch.
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done);
  });
}

// Why a paginated fetch loop stopped, in the words the run log prints. A user's
// Cancel and a blown deadline both arrive as an AbortError, and reporting a
// cancel as "timed out after 40 jobs" sends the next reader hunting a network
// fault that never happened.
export function loopFailure(
  error: unknown,
  fetched: number,
  signal?: AbortSignal,
): string {
  if (error instanceof Error && error.name === "AbortError") {
    return signal?.aborted
      ? `cancelled after ${fetched} jobs`
      : `timed out after ${fetched} jobs`;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

// The board slug out of a pasted board link, or the bare slug itself. The five
// boards added in phase 5 each advertise "or paste a <host> link" in the wizard
// and each needed the same two-branch parse; writing it five times is how the
// branches drift apart.
//
// A string carrying a slash or a dot and NOT matching this board's host is
// refused rather than taken as a slug: without that, an ashbyhq link pasted
// under Rippling would be interpolated into a Rippling URL and reported as a
// board that does not exist.
export function boardSlugFrom(
  input: string,
  hostPattern: RegExp,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(hostPattern);
  if (match?.[1]) return match[1];
  if (!trimmed.includes("/") && !trimmed.includes(".")) return trimmed;
  return null;
}

// Last resort for a display name, for the boards whose payload never states the
// employer's own spelling. Only ever a fallback: a board that does say its name
// (Rippling's companyName, Recruitee's company_name, SmartRecruiters' company)
// gets it right where this turns 'chess' into 'Chess'.
export function humanizeToken(token: string): string {
  return token.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "source",
  "fbclid",
  "gclid",
  "msclkid",
  "tk",
  "from",
  "vjk",
  "gh_src",
];

// Normalizes a URL for storage/clicking: only touches things that never change
// which resource the URL points to (tracking params, fragment, param order,
// trailing slash). Deliberately keeps host/protocol/www intact so the stored
// link stays valid.
export function normalizeJobUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    TRACKING_PARAMS.forEach((param) => {
      parsed.searchParams.delete(param);
    });
    parsed.searchParams.sort();
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

// Aggressive canonical form used only as a dedup comparison key (never stored
// or clicked), so it can safely fold host case and a leading "www.".
function urlDedupeKey(url: string): string {
  try {
    const parsed = new URL(normalizeJobUrl(url));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${parsed.pathname}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

interface DedupableJob {
  url?: string | null;
  title?: string;
  company?: string;
  location?: string;
}

// One key per job, shared by both the incoming batch and existing DB records so
// they compare identically. Falls back to a title/company/location signature
// when a job has no usable URL (otherwise linkless jobs re-add every run).
// Uses the same canonicalization as entity resolution (resolve.ts) — in
// particular the company legal-suffix stripping — so two postings that
// resolve to the same Company/JobTitle/Location record also dedupe as the
// same job.
//
// Single-key: kept for findExistingJobByUrl, which only ever asks about one
// URL. Everything that dedupes a batch uses jobDedupeKeys.
export function jobDedupeKey(job: DedupableJob): string {
  const url = job.url?.trim();
  if (url) return `url:${urlDedupeKey(url)}`;
  const meta = [
    canonicalizeEntityValue(job.title ?? ""),
    canonicalizeEntityValue(job.company ?? "", { stripLegalSuffix: true }),
    canonicalizeEntityValue(job.location ?? ""),
  ].join("|");
  return `meta:${meta}`;
}

// Every identity one job answers to. The URL key alone cannot see across
// sources: one Acme opening arriving as linkedin.com/jobs/view/4012345678 and
// as boards.greenhouse.io/acme/jobs/5566778 takes the url: branch on both
// sides, so title and company are never compared — two Job rows, two fitData
// analyses, two reachScores, two applications. The meta: fallback does not save
// it either, because it only fires when there is no URL and every fetched job
// has one.
//
// The role key is emitted only when BOTH company and title normalize to
// something non-empty. Without that guard a Telegram post whose company no
// parser could find yields `role:|seniorbackendengineer` and collapses two
// different employers into one row — a missing company is unmeasured, and
// unmeasured must not decide anything.
//
// Accepted trade-off: roleKey ignores location where the meta: key does not, so
// one title genuinely open in two cities at one company now collapses to a
// single row. That is the old panel's deliberate choice (the Grafana
// four-country case) and there is no way to keep both behaviours.
export function jobDedupeKeys(job: DedupableJob): string[] {
  const keys = [jobDedupeKey(job)];
  const company = canonicalizeEntityValue(job.company ?? "", {
    stripLegalSuffix: true,
  });
  const title = canonicalizeEntityValue(job.title ?? "");
  if (company && title) keys.push(`role:${roleKey(job.company, job.title)}`);
  return keys;
}

// Removes jobs already saved (existingKeys) and collapses duplicates within the
// batch itself. Every ATS source path runs through here.
// Accepts any key lookup with `.has` so callers can pass a Set or the
// getExistingJobDedupeMap Map directly.
export function dedupeJobs<T extends DedupableJob>(
  jobs: T[],
  existingKeys: { has(key: string): boolean },
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const job of jobs) {
    const keys = jobDedupeKeys(job);
    if (keys.some((key) => existingKeys.has(key) || seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    result.push(job);
  }
  return result;
}
