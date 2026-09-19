import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "../types";
import type { SearchOutcome } from "../ats/types";
import { decodeHtml } from "../html";
import { runDeadline } from "../utils";

// Remotive: GET https://remotive.com/api/remote-jobs — one call, no pagination.
//
// Field names below are copied off a live response (verified 19.09.2026), not
// recalled: the old panel's first lidesc pass read `p.description` and
// `p.employmentType` on a payload that spells them `desc` and `employment`,
// wrote twenty empty descriptions and reported "ok 20". A wrong name here is
// silent in exactly the same way — `undefined ?? ""` is a valid empty string.
export interface RemotiveJob {
  id?: number;
  // Already absolute, and it points at remotive.com rather than the employer.
  // Storing it is not a shortcut: Remotive's own API notice makes linking back
  // to this URL and naming Remotive as the source a condition of access.
  url?: string;
  title?: string;
  company_name?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

export interface RemotiveResponse {
  jobs?: RemotiveJob[];
  // Hyphens, not underscores, and there is no `total_count` on this payload at
  // all. Reading the name every other feed in the pool uses yields undefined,
  // which is a legal `available: null` — the coverage line would then say "the
  // source does not say how many exist" forever, about the one feed that does.
  "total-job-count"?: number;
  "job-count"?: number;
}

export function mapRemotiveJob(job: RemotiveJob): JobDetails {
  return {
    title: (job.title ?? "").trim(),
    company: job.company_name ?? "",
    // The feed always fills this ("Worldwide", "Europe", "USA, Canada"), but a
    // blank would be read by the strict-location gate as a location that
    // matches nothing. On a remote-only board "Remote" is the honest fallback.
    location: job.candidate_required_location || "Remote",
    description: decodeHtml(job.description ?? ""),
    url: job.url ?? "",
    postedDate: job.publication_date || undefined,
    // A free-text field that is usually the empty string; "" stored as a
    // salary reads in the LLM prompt as a range nobody quoted.
    salary: job.salary || undefined,
    employmentType: job.job_type || undefined,
    isRemote: true,
  };
}

export async function searchRemotiveJobs(
  config: {
    // Deliberately unread. The endpoint takes no cursor and no offset, and
    // every documented narrowing param is ignored: `?limit=200` came back with
    // the same 16 rows and the same `total-job-count: 16` as a bare call.
    // Looping on maxPages would re-fetch one page N times against a host whose
    // API notice says excessive requests are blocked. REMOTIVE_MAX_PAGES is 1
    // for the same reason.
    maxPages: number;
    // Remotive exposes no sponsorship field, and the board table does not mark
    // it visaFilter, so the wizard never renders the toggle here.
    visaSponsorshipOnly?: boolean;
  },
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  void config;

  // No page loop to check the signal at the top of: this board is one request,
  // so composing the run's cancel into its deadline is the whole of it.
  const deadline = runDeadline(
    APP_CONSTANTS.REMOTIVE_FETCH_TIMEOUT_MS,
    signal,
  );

  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];
  // Unknown depth is null, never 0: a response that never carried the count
  // has not measured the feed, and "0 available" beside "16 fetched" is a lie.
  let available: number | null = null;

  try {
    const response = await fetch(APP_CONSTANTS.REMOTIVE_BASE_URL, {
      signal: deadline.signal,
    });

    // Remotive's API notice asks for at most a handful of calls a day and says
    // excessive requests are blocked, so a throttle here is the source telling
    // us to back off, not a transient network fault. Naming it separately is
    // what puts "rate limited" rather than a bare status in the run log.
    if (response.status === 429) {
      errors.push({ token: "remotive", reason: "rate limited" });
    } else if (!response.ok) {
      errors.push({ token: "remotive", reason: `returned ${response.status}` });
    } else {
      const body: RemotiveResponse = await response.json();

      // An interstitial or a maintenance page and a feed with nothing new look
      // equally empty and must be treated oppositely: the first is a failure to
      // report, the second is a clean zero. `jobs` being an array is what tells
      // them apart — a page that is not the feed has no such key, and reading
      // it as "nothing new today" would finalize a blocked run as a quiet one.
      if (!body || !Array.isArray(body.jobs)) {
        errors.push({ token: "remotive", reason: "response was not the feed" });
      } else {
        jobs.push(...body.jobs.map(mapRemotiveJob));
        if (typeof body["total-job-count"] === "number") {
          available = body["total-job-count"];
        }
      }
    }
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "timed out"
        : error instanceof Error
          ? error.message
          : "Unknown error";
    errors.push({ token: "remotive", reason });
  } finally {
    deadline.release();
  }

  return { jobs, errors, coverage: { fetched: jobs.length, available } };
}
