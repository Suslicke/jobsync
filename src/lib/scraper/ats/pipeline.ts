import { APP_CONSTANTS } from "@/lib/constants";
import type { PrerankComponents } from "@/models/ai.schemas";
import type { JobDetails } from "../types";
import { scoreJob, passesFloor, locationMatches, buildIdf } from "./rank";

export interface PipelineConfig {
  targetTitles: string[];
  keywords: string[];
  locations: string[];
  strictLocation: boolean;
}

export interface ScoredJob {
  job: JobDetails;
  score: number;
  components: PrerankComponents;
}

export interface PipelineResult {
  // Top-K survivors to LLM-analyze (highest scoring).
  toAnalyze: ScoredJob[];
  // Remaining floor survivors saved un-analyzed.
  toSaveUnanalyzed: ScoredJob[];
  funnel: {
    deduped: number; // jobs handed in (already deduped by the runner)
    located: number | null; // survivors after strict location gate (null if off)
    floorSurvivors: number; // jobs clearing the floor, before the cap ceiling
    scoreCut: number; // floor survivors dropped by the minimum-score gate
    // True when the minimum-score gate was bypassed entirely. scoreCut cannot
    // carry this: on the fail-open path it is 0, which reads as "nothing was
    // cut" rather than "the gate did no work".
    scoreFloorFailedOpen: boolean;
    relevant: number; // survivors after the score gate and cap (the LLM budget)
  };
}

// Pure funnel: optional strict-location gate -> score -> relevance floor ->
// cap ceiling -> top-K split. No I/O, no LLM; unit-testable in isolation.
export function runAtsPipeline(
  fetchedJobs: JobDetails[],
  config: PipelineConfig,
  resumeSkills: string[],
  options?: { k?: number; cap?: number; corpus?: JobDetails[] },
): PipelineResult {
  const k = options?.k ?? APP_CONSTANTS.MAX_JOBS_PER_RUN;
  const cap = options?.cap ?? APP_CONSTANTS.ATS_LISTING_CAP;

  const deduped = fetchedJobs.length;

  // Term-rarity weights are derived from the full fetched corpus (pre-dedup) so
  // they stay stable on steady-state runs where few new jobs remain.
  const idf = buildIdf(options?.corpus ?? fetchedJobs);

  const gateActive = config.strictLocation && config.locations.length > 0;
  const located = gateActive
    ? fetchedJobs.filter((job) =>
        locationMatches(job.location, config.locations),
      )
    : null;

  const working = located ?? fetchedJobs;

  const scored: ScoredJob[] = working.map((job) => {
    const { score, components } = scoreJob(
      job,
      config.targetTitles,
      config.keywords,
      resumeSkills,
      config.locations,
      idf,
    );
    return { job, score, components };
  });

  const floorSurvivors = scored
    .filter((s) => passesFloor(s.components))
    .sort((a, b) => b.score - a.score);

  // Term presence is not enough to be worth an LLM call — a single generic hit
  // clears the floor. Cut the weak tail by weighted score too. Fails open: idf
  // is corpus-relative, so a board where every job shares the user's terms
  // scores everything near zero, and dropping that whole run would be worse
  // than analyzing it.
  //
  // On a query or feed board that is not the exception but every run: every
  // fetched job matched the keywords by construction, so every term's df ~ n
  // and every idf ~ 0. The fail-open is reported rather than left to be
  // discovered in production — the real ranking there is the fitData and
  // reachScore computed at persist time; the prerank is only an LLM budget
  // allocator.
  const strong = floorSurvivors.filter(
    (s) => s.score >= APP_CONSTANTS.ATS_MIN_PRERANK_SCORE,
  );
  const failedOpen = strong.length === 0 && floorSurvivors.length > 0;
  const ranked = strong.length > 0 ? strong : floorSurvivors;

  const capped = ranked.slice(0, cap);

  return {
    toAnalyze: capped.slice(0, k),
    toSaveUnanalyzed: capped.slice(k),
    funnel: {
      deduped,
      located: located ? located.length : null,
      floorSurvivors: floorSurvivors.length,
      scoreCut: floorSurvivors.length - ranked.length,
      scoreFloorFailedOpen: failedOpen,
      relevant: capped.length,
    },
  };
}
