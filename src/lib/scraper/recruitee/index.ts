import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { AtsCompany } from "@/models/automation.model";
import type { JobDetails, ScraperResult } from "../types";
import type { ResolveResult, SearchOutcome } from "../ats/types";
import {
  ATS_TOKEN_REGEX,
  boardSlugFrom,
  errorReason,
  humanizeToken,
  runDeadline,
} from "../utils";

// Recruitee's public careers API: GET https://<slug>.recruitee.com/api/offers/.
// The whole board arrives in one response, descriptions included — no detail
// pass, and so no hydrate().
//
// Verified live 19.09.2026 against the `labordeearles` board (4 offers, 117 KB).

interface RecruiteeOffer {
  id?: number;
  slug?: string;
  title?: string;
  // Already composed ("Lafayette, Louisiana, United States").
  location?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  on_site?: boolean;
  // "fulltime_permanent" — a schedule and a contract welded together.
  employment_type_code?: string;
  careers_url?: string;
  careers_apply_url?: string;
  // "2026-09-17 19:52:08 UTC": a space instead of a T, and a trailing zone name.
  published_at?: string;
  created_at?: string;
  description?: string;
  // Half the ad, and the half that names the stack.
  requirements?: string;
  // The employer's own spelling of its name, unlike the slug.
  company_name?: string;
}

interface RecruiteeOffersResponse {
  offers?: RecruiteeOffer[];
}

// The three flags are on every offer, so all-false is a measurement and not an
// absence. An offer carrying none of them stays unmeasured.
function mapRecruiteeWorkplace(offer: RecruiteeOffer): string | undefined {
  if (offer.remote) return "REMOTE";
  if (offer.hybrid) return "HYBRID";
  if (offer.on_site) return "ONSITE";
  return undefined;
}

// normalizeJobType strips the separator and looks the whole string up, so
// "parttime_permanent" folds to "parttimepermanent", misses the table and
// lands on the full-time default. Only the leading segment is the schedule.
function employmentType(code?: string): string | undefined {
  const schedule = code?.split("_")[0]?.trim();
  return schedule || undefined;
}

// Date.parse understands "2026-09-17 19:52:08 UTC" in V8, but the value is
// stored and compared as a string downstream, so it is normalized here rather
// than left in a format nothing else in the pool uses.
function postedDate(offer: RecruiteeOffer): string | undefined {
  const raw = offer.published_at || offer.created_at;
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString();
}

export function mapRecruiteeOffer(
  offer: RecruiteeOffer,
  companyName: string,
): JobDetails {
  // requirements is a separate field holding the "Skills/Abilities" half of the
  // ad. Keeping only `description` is the Lever descriptionPlain mistake: an
  // intro about the company, no technology named, and a match percentage
  // measured against nothing.
  const description = [offer.description, offer.requirements]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n");

  return {
    title: (offer.title ?? "").trim(),
    // The response names the employer, so the response wins; the watchlist
    // entry is the fallback. A board reached through a rename redirect
    // (zignaly -> zigchain) then carries the name it goes by now.
    company: offer.company_name?.trim() || companyName,
    location:
      offer.location?.trim() ||
      [offer.city, offer.country]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(", ") ||
      (offer.remote ? "Remote" : ""),
    description,
    url: offer.careers_url ?? "",
    postedDate: postedDate(offer),
    employmentType: employmentType(offer.employment_type_code),
    workplaceType: mapRecruiteeWorkplace(offer),
  };
}

// Fetch one board. One call, no pagination.
export async function fetchRecruiteeBoardJobs(
  name: string,
  token: string,
  signal?: AbortSignal,
): Promise<ScraperResult<JobDetails[]>> {
  const deadline = runDeadline(
    APP_CONSTANTS.RECRUITEE_FETCH_TIMEOUT_MS,
    signal,
  );

  try {
    const url = `https://${token}${APP_CONSTANTS.RECRUITEE_BOARD_SUFFIX}/api/offers/`;
    const response = await fetch(url, { signal: deadline.signal });

    // 429 is distinct so the run surfaces the existing "rate limited" label.
    if (response.status === 429) {
      return { success: false, error: { type: "rate_limited" } };
    }
    // A retired slug answers a real 404 with {"error":"Not Found"}, so failure
    // here is failure and never an empty board.
    if (!response.ok) {
      return {
        success: false,
        error: {
          type: "network",
          message: `Board '${token}' returned ${response.status}`,
        },
      };
    }

    const data: RecruiteeOffersResponse = await response.json();
    if (!Array.isArray(data.offers)) {
      return {
        success: false,
        error: { type: "parse", message: `Board '${token}' malformed payload` },
      };
    }

    // An offer with no careers_url has nothing to open and nothing to dedupe
    // on but its title, so it is dropped rather than saved as a dead row.
    const jobs = data.offers
      .map((offer) => mapRecruiteeOffer(offer, name))
      .filter((job) => job.url);
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

// Board slug out of a pasted <slug>.recruitee.com link or a bare slug, probed
// live. Without it the save boundary tested the whole URL against
// ATS_TOKEN_REGEX and answered "Paste a Recruitee board token" to the link the
// wizard had just asked for.
//
// A board with no offers open still answers 200 with an empty array, so the
// name falls back to the humanized slug there — company_name only exists on an
// offer. Verified live 19.09.2026: `wallarm` is a real board with nothing open.
export async function resolveRecruiteeBoard(
  input: string,
): Promise<ResolveResult> {
  const slug = boardSlugFrom(input, /([a-z0-9_-]+)\.recruitee\.com/i);
  const token = slug?.toLowerCase();
  if (!token || !ATS_TOKEN_REGEX.test(token)) {
    return {
      success: false,
      message: "Paste a recruitee.com link or a board token",
    };
  }

  try {
    const res = await fetch(
      `https://${token}${APP_CONSTANTS.RECRUITEE_BOARD_SUFFIX}/api/offers/`,
    );
    // A retired slug answers a real 404 with {"error":"Not Found"}.
    if (res.status === 404) {
      return { success: false, message: `No Recruitee board found for '${token}'` };
    }
    if (!res.ok) {
      return {
        success: false,
        message: `Could not validate board (${res.status})`,
      };
    }

    const body: RecruiteeOffersResponse = await res.json();
    if (!Array.isArray(body.offers)) {
      return { success: false, message: `'${token}' is not a Recruitee board` };
    }
    const name = body.offers[0]?.company_name?.trim();
    return { success: true, name: name || humanizeToken(token), token };
  } catch {
    return { success: false, message: "Could not reach Recruitee" };
  }
}

// Fetch a watchlist in parallel (bounded concurrency) with per-token isolation.
export async function searchRecruiteeJobs(
  companies: AtsCompany[],
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const limit = pLimit(APP_CONSTANTS.RECRUITEE_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    companies.map(({ name, token }) =>
      limit(() => fetchRecruiteeBoardJobs(name, token, signal)),
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
        result.reason instanceof Error ? result.reason.message : "Unknown error";
      errors.push({ token, reason });
    }
  });

  return { jobs, errors };
}
