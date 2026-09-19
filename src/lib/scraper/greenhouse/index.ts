import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails, ScraperResult } from "../types";
import { errorReason, runDeadline } from "../utils";
import { decodeHtml } from "../html";

interface GreenhouseJob {
  title?: string;
  company_name?: string;
  location?: { name?: string } | null;
  absolute_url: string;
  content?: string;
  first_published?: string;
  updated_at?: string;
}

interface GreenhouseBoardResponse {
  jobs?: GreenhouseJob[];
  meta?: { total?: number };
}

function mapGreenhouseJob(job: GreenhouseJob): JobDetails {
  return {
    title: (job.title ?? "").trim(),
    company: job.company_name ?? "",
    location: job.location?.name ?? "",
    description: decodeHtml(job.content ?? ""),
    url: job.absolute_url,
    postedDate: job.first_published || job.updated_at,
  };
}

// Fetch all published jobs for one board with full content.
export async function fetchBoardJobs(
  token: string,
  signal?: AbortSignal,
): Promise<ScraperResult<JobDetails[]>> {
  const deadline = runDeadline(
    APP_CONSTANTS.GREENHOUSE_FETCH_TIMEOUT_MS,
    signal,
  );

  try {
    const url = `${APP_CONSTANTS.GREENHOUSE_BASE_URL}/${encodeURIComponent(
      token,
    )}/jobs?content=true`;

    const response = await fetch(url, { signal: deadline.signal });

    if (!response.ok) {
      return {
        success: false,
        error: {
          type: "network",
          message: `Board '${token}' returned ${response.status}`,
        },
      };
    }

    const data: GreenhouseBoardResponse = await response.json();
    const jobs = (data.jobs ?? []).map(mapGreenhouseJob);
    return { success: true, data: jobs };
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
export async function searchGreenhouseJobs(
  companies: { name: string; token: string }[],
  signal?: AbortSignal,
): Promise<{ jobs: JobDetails[]; errors: { token: string; reason: string }[] }> {
  const limit = pLimit(APP_CONSTANTS.GREENHOUSE_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    companies.map(({ token }) => limit(() => fetchBoardJobs(token, signal))),
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
