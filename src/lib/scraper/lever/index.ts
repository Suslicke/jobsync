import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails, ScraperResult } from "../types";
import { delay, errorReason, runDeadline } from "../utils";
import type { LeverHost, LeverPosting } from "./types";
import { mapLeverJob } from "./mapper";

function leverBaseUrl(host?: LeverHost): string {
  return host === "eu"
    ? APP_CONSTANTS.LEVER_EU_BASE_URL
    : APP_CONSTANTS.LEVER_BASE_URL;
}

// Fetch the complete list of postings for one board. Pagination is an internal
// detail — Lever pages via skip/limit with no total, so we page until a short
// page (or the safety ceiling), guarding against a board that ignores `skip`.
export async function fetchLeverBoardJobs(
  name: string,
  token: string,
  host?: LeverHost,
  signal?: AbortSignal,
): Promise<ScraperResult<JobDetails[]>> {
  // One deadline for the whole loop, plus the run's own cancel.
  const deadline = runDeadline(APP_CONSTANTS.LEVER_FETCH_TIMEOUT_MS, signal);

  try {
    const all: JobDetails[] = [];
    let prevFirstId: string | undefined; // repeat-page guard
    for (let page = 0; page < APP_CONSTANTS.LEVER_MAX_PAGES; page++) {
      const skip = page * APP_CONSTANTS.LEVER_PAGE_LIMIT;
      const url =
        `${leverBaseUrl(host)}/${encodeURIComponent(token)}` +
        `?mode=json&skip=${skip}&limit=${APP_CONSTANTS.LEVER_PAGE_LIMIT}`;

      const res = await fetch(url, { signal: deadline.signal });

      // 429 is distinct from a generic failure so the run surfaces the
      // existing "rate_limited" label instead of a bare network error.
      if (res.status === 429) {
        return { success: false, error: { type: "rate_limited" } };
      }
      if (!res.ok) {
        return {
          success: false,
          error: {
            type: "network",
            message: `Board '${token}' returned ${res.status}`,
          },
        };
      }

      const batch: LeverPosting[] = await res.json();
      if (!Array.isArray(batch)) {
        return {
          success: false,
          error: {
            type: "parse",
            message: `Board '${token}' malformed page`,
          },
        };
      }

      // Repeat-page guard: if a full page returns the same lead id as the
      // previous page, Lever is ignoring `skip` — stop rather than refetch the
      // same rows up to LEVER_MAX_PAGES.
      if (batch.length > 0 && batch[0]?.id === prevFirstId) break;
      prevFirstId = batch[0]?.id;

      // Company name isn't in the payload — carry it from the seed/user.
      all.push(...batch.map((p) => mapLeverJob(p, name)));

      if (batch.length < APP_CONSTANTS.LEVER_PAGE_LIMIT) break; // last page

      // Politeness delay between sequential pages of the same board (bounded by
      // LEVER_FETCH_TIMEOUT_MS via the abort controller).
      await delay(APP_CONSTANTS.LEVER_PAGE_DELAY_MS, signal);
    }
    return { success: true, data: all };
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
// Mirrors searchGreenhouseJobs; only the fetch fn + concurrency differ.
export async function searchLeverJobs(
  companies: { name: string; token: string; host?: LeverHost }[],
  signal?: AbortSignal,
): Promise<{ jobs: JobDetails[]; errors: { token: string; reason: string }[] }> {
  const limit = pLimit(APP_CONSTANTS.LEVER_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    companies.map(({ name, token, host }) =>
      limit(() => fetchLeverBoardJobs(name, token, host, signal)),
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
        result.reason instanceof Error
          ? result.reason.message
          : "Unknown error";
      errors.push({ token, reason });
    }
  });

  return { jobs, errors };
}
