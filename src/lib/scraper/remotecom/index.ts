import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "../types";
import type { SearchOutcome } from "../ats/types";
import { decodeHtml } from "../html";
import { delay, loopFailure, runDeadline } from "../utils";

// Remote.com: GET https://talent-api.remote.com/api/v1/public/jobs?page=N — 20
// rows a page against a stated total_count (6153 on 19.09.2026, 308 pages).
//
// Field names below are copied off a live response (verified 19.09.2026), not
// recalled: the old panel's first lidesc pass read `p.description` and
// `p.employmentType` on a payload that spells them `desc` and `employment`,
// wrote twenty empty descriptions and reported "ok 20". A wrong name here is
// silent in exactly the same way — `undefined ?? ""` is a valid empty string.
export interface RemotecomJob {
  title?: string;
  slug?: string;
  // Present on the list endpoint and empty on every row of it. The field
  // existing is precisely what makes this dangerous: the old panel scored that
  // empty string and wrote `pct: 0` on 806 rows, which reads as "nothing in the
  // stack matched" rather than "there was no text to measure". The descriptions
  // live on the detail endpoint, which is what hydrateRemotecomJobs is for.
  description?: string;
  published_at?: string;
  employment_type?: string;
  // Null on roughly two rows in three. The old collector used it as the job's
  // URL, so those rows were stored with no link at all — and a job with no URL
  // falls back in jobDedupeKeys to title|company|location. The canonical
  // posting page is built from the two slugs instead; see remotecomJobUrl.
  apply_url?: string | null;
  // True for 1 posting in 5794 on a full scan: employers simply do not fill it
  // in, which is why the board table does not mark this feed visaFilter. The
  // usable signal is hiring_location.type === "global" — an employer hiring
  // from anywhere answers the no-work-permit problem the same way sponsorship
  // would — and that one lands in `location` where the fit analysis reads it.
  visa_sponsorship_offered?: boolean;
  company_profile?: { name?: string; slug?: string } | null;
  compensation?: {
    minimum?: number | null;
    maximum?: number | null;
    currency?: { code?: string } | null;
    frequency?: string | null;
  } | null;
  hiring_location?: {
    type?: string;
    included_locations?: { value?: { name?: string } | null }[] | null;
  } | null;
  workplace_location?: { type?: string } | null;
}

// The detail endpoint wraps ONE job in the same `data` envelope the list
// endpoint uses for an array, which is the whole difference between the two.
export interface RemotecomDetail {
  data?: RemotecomJob;
}

export interface RemotecomPage {
  data?: {
    jobs?: RemotecomJob[];
    total_count?: number;
    current_page?: number;
    total_pages?: number;
  };
}

// The public posting page. Not in APP_CONSTANTS because it is a different host
// from REMOTECOM_BASE_URL: the API answers on talent-api.remote.com and the
// page a human opens is remote.com/jobs/<company slug>/<job slug>, both halves
// of which are already in the payload.
const REMOTECOM_SITE_JOB_URL = "https://remote.com/jobs";

export function remotecomJobUrl(job: RemotecomJob): string {
  const company = job.company_profile?.slug;
  if (!company || !job.slug) return "";
  return `${REMOTECOM_SITE_JOB_URL}/${company}/${job.slug}`;
}

// The detail endpoint mirrors the public page's path under the API host.
function remotecomDetailUrl(jobUrl: string): string | null {
  const slugs = jobUrl.split(`${REMOTECOM_SITE_JOB_URL}/`)[1];
  return slugs ? `${APP_CONSTANTS.REMOTECOM_BASE_URL}/${slugs}` : null;
}

const WORKPLACE_BY_TYPE: Record<string, string> = {
  remote: "REMOTE",
  hybrid: "HYBRID",
  on_site: "ONSITE",
};

export function remotecomLocation(job: RemotecomJob): string {
  const loc = job.hiring_location;
  // The board's whole reason for being in this pool: an employer willing to
  // hire from anywhere. It arrives as a type with included_locations set to
  // null, so joining the list would produce an empty string for exactly the
  // rows worth finding.
  if (loc?.type === "global") return "Worldwide";
  const names = (loc?.included_locations ?? [])
    .map((entry) => entry?.value?.name)
    .filter((name): name is string => !!name);
  if (names.length > 0) return names.join(", ");
  // type "timezone" carries a city ("Denver") that is an offset anchor, not a
  // hiring location — the role is open across a band of hours around it.
  // Writing "Denver" here would advertise an onsite city for a remote job.
  return "";
}

// minimum/maximum are in the currency's MINOR units: the Proxify Senior Backend
// (Python/Django) row reads 300000-600000 EUR monthly, which is EUR 3000-6000.
// Passed through unscaled it would reach the LLM prompt as a six-figure monthly
// salary on every row on the board.
export function remotecomSalary(job: RemotecomJob): string | undefined {
  const comp = job.compensation;
  const minor = (value: unknown): number | null =>
    typeof value === "number" && value > 0 ? Math.round(value / 100) : null;
  const min = minor(comp?.minimum);
  const max = minor(comp?.maximum);
  if (min === null && max === null) return undefined;
  const amount =
    min !== null && max !== null && min !== max
      ? `${min}-${max}`
      : String(min ?? max);
  return [amount, comp?.currency?.code, comp?.frequency]
    .filter(Boolean)
    .join(" ");
}

export function mapRemotecomJob(job: RemotecomJob): JobDetails {
  return {
    title: (job.title ?? "").trim(),
    company: job.company_profile?.name ?? "",
    location: remotecomLocation(job),
    description: decodeHtml(job.description ?? ""),
    url: remotecomJobUrl(job),
    postedDate: job.published_at || undefined,
    salary: remotecomSalary(job),
    employmentType: job.employment_type || undefined,
    workplaceType: job.workplace_location?.type
      ? WORKPLACE_BY_TYPE[job.workplace_location.type]
      : undefined,
  };
}

export function remotecomPageUrl(page: number): string {
  return `${APP_CONSTANTS.REMOTECOM_BASE_URL}?page=${page}`;
}

export async function searchRemotecomJobs(
  config: {
    maxPages: number;
    // Remote.com's own sponsorship flag is unusable (see
    // visa_sponsorship_offered above) and the board table does not mark this
    // feed visaFilter, so the wizard never renders the toggle here.
    visaSponsorshipOnly?: boolean;
  },
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  // One deadline for the whole loop, plus the run's own cancel.
  const deadline = runDeadline(
    APP_CONSTANTS.REMOTECOM_FETCH_TIMEOUT_MS,
    signal,
  );

  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];
  // Unknown depth is null, never 0: a run that never saw total_count has not
  // measured the feed, and "0 available" beside "200 fetched" is a lie.
  let available: number | null = null;

  // The configured page count is a request, not a licence: the feed is 308
  // pages deep and a hand-edited sourceConfig asking for all of them would be
  // answered at full speed against a free, unauthenticated host.
  const maxPages = Math.min(config.maxPages, APP_CONSTANTS.REMOTECOM_MAX_PAGES);

  try {
    for (let page = 1; page <= maxPages; page++) {
      // Checked at the top of the page loop, not only around the fetch: a
      // cancelled run must stop asking on the next page rather than when the
      // whole walk finishes.
      if (signal?.aborted) break;

      const response = await fetch(remotecomPageUrl(page), {
        signal: deadline.signal,
      });

      if (response.status === 429) {
        errors.push({ token: "remotecom", reason: `rate limited on page ${page}` });
        break;
      }
      if (!response.ok) {
        errors.push({
          token: "remotecom",
          reason: `page ${page} returned ${response.status}`,
        });
        break;
      }

      const body: RemotecomPage = await response.json();

      // An interstitial or a maintenance page and a page past the end of the
      // feed look equally empty and must be treated oppositely: the first is a
      // failure to report, the second is a clean end of feed. `data.jobs` being
      // an array is what tells them apart — a page that is not the feed has no
      // such key, and reading it as "the feed is exhausted" would finalize a
      // blocked run as a quiet one.
      if (!Array.isArray(body?.data?.jobs)) {
        errors.push({
          token: "remotecom",
          reason: `page ${page} was not a job page`,
        });
        break;
      }

      // Kept from the first page that carries it: it is the depth at the moment
      // the run started, and the feed's count moves between requests.
      if (available === null && typeof body.data.total_count === "number") {
        available = body.data.total_count;
      }

      if (body.data.jobs.length === 0) break;
      jobs.push(...body.data.jobs.map(mapRemotecomJob));

      const totalPages = body.data.total_pages;
      if (typeof totalPages === "number" && page >= totalPages) break;

      await delay(APP_CONSTANTS.REMOTECOM_PAGE_DELAY_MS, signal);
    }
  } catch (error) {
    // Whatever was already fetched is kept and returned alongside the error: a
    // fresh top is this board's normal result, so a page-six timeout is a
    // shorter run, not a failed one. The runner only calls the board dead when
    // errors arrive with no jobs at all.
    errors.push({
      token: "remotecom",
      reason: loopFailure(error, jobs.length, signal),
    });
  } finally {
    deadline.release();
  }

  return { jobs, errors, coverage: { fetched: jobs.length, available } };
}

// The list endpoint ships `description: ""` on every row, so without this pass
// every Remote.com job reaches the LLM matcher with no text to match against.
// Runs on the ranked survivors only — at most ATS_LISTING_CAP of them — because
// a 6000-row feed cannot cost one detail request per row it merely saw.
export async function hydrateRemotecomJobs(
  jobs: JobDetails[],
  signal?: AbortSignal,
): Promise<JobDetails[]> {
  const filled: JobDetails[] = [];

  for (const job of jobs) {
    if (signal?.aborted) break;
    const detailUrl = remotecomDetailUrl(job.url);
    if (!detailUrl) continue;

    const deadline = runDeadline(
      APP_CONSTANTS.REMOTECOM_FETCH_TIMEOUT_MS,
      signal,
    );
    try {
      const response = await fetch(detailUrl, { signal: deadline.signal });
      // A withdrawn posting 404s. Skipping it rather than failing the pass is
      // what the runner's by-URL match expects: the returned array is allowed
      // to be shorter than the one handed in, and the un-hydrated listing is
      // still saved with what the card carried.
      if (!response.ok) continue;
      const body: RemotecomDetail = await response.json();
      const description = body?.data?.description;
      if (typeof description !== "string" || !description) continue;
      filled.push({ ...job, description: decodeHtml(description) });
    } catch {
      // One dead posting must not abort the pass; the rest of the survivors
      // still get their descriptions.
      continue;
    } finally {
      deadline.release();
    }

    // Sequential with the same politeness delay the listing pass uses: this is
    // up to 50 requests in a row against a host that publishes no rate limit,
    // and guessing a safe concurrency is how a shared IP gets blocked.
    await delay(APP_CONSTANTS.REMOTECOM_PAGE_DELAY_MS, signal);
  }

  return filled;
}
