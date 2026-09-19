import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "../types";
import type { SearchOutcome } from "../ats/types";
import { decodeHtml } from "../html";
import { runDeadline } from "../utils";

// Working Nomads: GET https://www.workingnomads.com/api/exposed_jobs/ — a bare
// top-level array, one call, no pagination and no envelope.
//
// Field names below are copied off a live response (verified 19.09.2026), not
// recalled: the old panel's first lidesc pass read `p.description` and
// `p.employmentType` on a payload that spells them `desc` and `employment`,
// wrote twenty empty descriptions and reported "ok 20". A wrong name here is
// silent in exactly the same way — `undefined ?? ""` is a valid empty string.
//
// The trap this feed sets is the same one from the other side: the old
// collector read `x.id ?? <tail of the url>`, and `x.id` has never existed on
// this payload. Every row took the fallback, so the bug only looked like a
// harmless default. Nothing here reads an id — the URL is the identity, which
// is what jobDedupeKeys wants anyway.
export interface WorkingNomadsJob {
  // /job/go/<id>/ is a 302 straight to the employer's own application form,
  // the cleanest apply path of any feed in the pool. Stored as-is rather than
  // followed: resolving it at collection time would cost one request per row
  // and burn the redirect on a job nobody has decided to apply to yet.
  url?: string;
  title?: string;
  description?: string;
  company_name?: string;
  category_name?: string;
  // A comma-separated STRING ("english,spanish,business"), not an array.
  tags?: string;
  location?: string;
  pub_date?: string;
}

// Absolute on every row seen today, but the old collector carried this guard
// and a relative path stored as a job URL is a link that opens nothing — and,
// worse, one that collides in jobDedupeKeys with every other relative path.
// Resolved against the API URL rather than a second hardcoded host, so there is
// only one place the domain is written down.
export function workingNomadsUrl(url: string): string {
  if (!url) return "";
  try {
    return new URL(url, APP_CONSTANTS.WORKINGNOMADS_BASE_URL).toString();
  } catch {
    return url;
  }
}

export function mapWorkingNomadsJob(job: WorkingNomadsJob): JobDetails {
  return {
    title: (job.title ?? "").trim(),
    company: job.company_name ?? "",
    // "Global", "Anywhere", "USA" — a hiring restriction on a remote role. A
    // blank would be read by the strict-location gate as matching nothing.
    location: job.location || "Remote",
    description: decodeHtml(job.description ?? ""),
    url: workingNomadsUrl(job.url ?? ""),
    postedDate: job.pub_date || undefined,
    isRemote: true,
  };
}

export async function searchWorkingNomadsJobs(
  config: {
    // Deliberately unread: the endpoint is a single un-paginated array with no
    // cursor, offset or limit, so looping on maxPages would re-fetch the same
    // rows. WORKINGNOMADS_MAX_PAGES is 1 for the same reason.
    maxPages: number;
    // No sponsorship field on this feed, and the board table does not mark it
    // visaFilter, so the wizard never renders the toggle here.
    visaSponsorshipOnly?: boolean;
  },
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  void config;

  // No page loop to check the signal at the top of: this board is one request,
  // so composing the run's cancel into its deadline is the whole of it.
  const deadline = runDeadline(
    APP_CONSTANTS.WORKINGNOMADS_FETCH_TIMEOUT_MS,
    signal,
  );

  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];

  try {
    const response = await fetch(APP_CONSTANTS.WORKINGNOMADS_BASE_URL, {
      signal: deadline.signal,
    });

    if (response.status === 429) {
      errors.push({ token: "workingnomads", reason: "rate limited" });
    } else if (!response.ok) {
      errors.push({
        token: "workingnomads",
        reason: `returned ${response.status}`,
      });
    } else {
      const body: unknown = await response.json();

      // An interstitial or a maintenance page and a feed with nothing new look
      // equally empty and must be treated oppositely: the first is a failure to
      // report, the second is a clean zero. Being an array is the only thing
      // that tells them apart on a payload with no envelope to inspect, and
      // reading a blocked response as "nothing new today" would finalize a
      // blocked run as a quiet one.
      if (!Array.isArray(body)) {
        errors.push({
          token: "workingnomads",
          reason: "response was not the feed",
        });
      } else {
        jobs.push(...(body as WorkingNomadsJob[]).map(mapWorkingNomadsJob));
      }
    }
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "timed out"
        : error instanceof Error
          ? error.message
          : "Unknown error";
    errors.push({ token: "workingnomads", reason });
  } finally {
    deadline.release();
  }

  // The feed states no total anywhere, so its depth is exactly what came back.
  // `available: null` rather than `jobs.length`: the two mean different things,
  // and claiming the run saw everything is a measurement nobody made.
  return { jobs, errors, coverage: { fetched: jobs.length, available: null } };
}
