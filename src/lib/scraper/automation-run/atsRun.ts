import type {
  Automation,
  FunnelStage,
} from "@/models/automation.model";
import type { BoardProvider, SearchOutcome } from "../ats/types";
import { boardById, type BoardUnit } from "../boards";
import { runAtsPipeline } from "../ats/pipeline";
import type { ScoredJob } from "../ats/pipeline";
import type { JobDetails } from "../types";
import { dedupeJobs } from "../utils";
import { getExistingJobDedupeMap } from "@/lib/jobs/jobDedupe";
import { automationLogger } from "@/lib/automation-logger";
import { log } from "@/lib/telemetry";
import type { RunnerResult, ResumeWithSections } from "./types";
import {
  getAutomationMatchLimit,
  getDefaultModelForProvider,
  getUserAiSettings,
} from "./aiSettings";
import { parseBoardConfig, targetCount, type BoardRunConfig } from "./config";
import { extractResumeSkills } from "./resumeText";
import { buildSkillTerms } from "./skillTags";
import { persistDiscoveredJob, scalePrerank } from "./persist";
import { matchJobToResume } from "./match";
import { finalizeRun } from "./finalize";

// The unit of work the board actually counts in, taken from the board table.
// Three user-visible lines used to assume it was always `companies.length`, so
// a feed run passing through unchanged would have printed "Fetching 1
// companies".
const UNIT_PLURAL: Record<BoardUnit, string> = {
  company: "companies",
  query: "queries",
  channel: "channels",
  feed: "feeds",
};

function counted(n: number, unit: BoardUnit): string {
  return `${n} ${n === 1 ? unit : UNIT_PLURAL[unit]}`;
}

function describeTargets(
  provider: BoardProvider,
  config: BoardRunConfig,
): string {
  const unit = boardById(provider.id)?.unit ?? "company";
  switch (config.kind) {
    case "companies":
      return counted(config.companies.length, unit);
    case "query":
      return `${counted(config.queries.length, unit)} x ${config.geos.length} ${config.geos.length === 1 ? "location" : "locations"}`;
    case "channel":
      return counted(config.channels.length, unit);
    case "feed":
      return "the feed";
  }
}

// The one place the kind is read. The provider and the config agree because
// both come from the same board id, but the compiler cannot see that through
// the registry's Partial<Record<...>>, hence the narrowing pairs.
async function searchBoard(
  provider: BoardProvider,
  config: BoardRunConfig,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  if (provider.kind === "companies" && config.kind === "companies") {
    return provider.search(config.companies, signal);
  }
  if (provider.kind === "query" && config.kind === "query") {
    return provider.search(
      { queries: config.queries, geos: config.geos },
      signal,
    );
  }
  if (provider.kind === "feed" && config.kind === "feed") {
    return provider.search(
      {
        maxPages: config.maxPages,
        visaSponsorshipOnly: config.visaSponsorshipOnly,
      },
      signal,
    );
  }
  if (provider.kind === "channel" && config.kind === "channel") {
    return provider.search({ channels: config.channels }, signal);
  }
  // Only reachable if a board's table row and its registry entry disagree
  // about the kind, which is a mis-registration, not a runtime condition.
  return {
    jobs: [],
    errors: [
      {
        token: provider.id,
        reason: `configured as ${config.kind} but registered as ${provider.kind}`,
      },
    ],
  };
}

export async function runAtsRun(
  automation: Automation,
  provider: BoardProvider,
  runId: string,
  resume: ResumeWithSections,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const label = `[${provider.label}]`;
  const config = parseBoardConfig(automation.sourceConfig, automation.jobBoard);

  if (!config || targetCount(config) === 0) {
    automationLogger.log(
      automation.id,
      "error",
      `${label} Nothing configured to search`,
    );
    automationLogger.endRun(automation.id);
    return await finalizeRun(runId, {
      status: "failed",
      errorMessage: "no_targets",
      jobsSearched: 0,
      jobsDeduplicated: 0,
      jobsProcessed: 0,
      jobsMatched: 0,
      jobsSaved: 0,
    });
  }

  try {
    automationLogger.log(
      automation.id,
      "info",
      `${label} Fetching ${describeTargets(provider, config)}...`,
    );

    // The kind decides the argument and nothing else; everything below this
    // line is the same code the three company boards have always run.
    const {
      jobs: fetched,
      errors,
      coverage,
    } = await searchBoard(provider, config, signal);

    // A posting with no link cannot be applied to, and storing one poisons the
    // user's whole discovery history: normalizeJobUrl("") is "", the partial
    // index Job_userId_jobUrl_automation_key treats "" as a value, and so the
    // FIRST link-less job a user ever saves makes every later one fail with
    // P2002 — which persistDiscoveredJob swallows as saved:false with no log
    // line anywhere. Five of the feed adapters emit "" when the payload carries
    // no link (remote.com alone does it whenever either slug is missing), and
    // the dedup keys do not catch it either: "" is falsy, so each such job takes
    // the meta: branch and is correctly called new, only for persist to drop it.
    //
    // Filtered here rather than in five adapters because the rule belongs to the
    // thing that saves, not to any one source — and counted, because the run
    // history showed a healthy run every time it happened.
    const jobs = fetched.filter((job) => job.url.trim());
    const unlinkable = fetched.length - jobs.length;
    if (unlinkable > 0) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} ${unlinkable} posting(s) carried no link and were skipped`,
      );
    }

    for (const err of errors) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} Board '${err.token}' ${err.reason} — skipped`,
      );
    }

    // Every source failed and nothing came back. Today that finalized as
    // `completed` with zeros, indistinguishable in the run history from a
    // board with nothing new — and with one feed per automation that would be
    // the common case, so a dead source would look like a quiet one.
    if (errors.length > 0 && jobs.length === 0) {
      automationLogger.log(
        automation.id,
        "error",
        `${label} Every source failed — nothing was fetched`,
      );
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status: "failed",
        errorMessage: "all_sources_failed",
        jobsSearched: 0,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const jobsSearched = jobs.length;
    automationLogger.log(
      automation.id,
      "success",
      `${label} Fetched ${jobsSearched} jobs from ${describeTargets(provider, config)}`,
      { jobsSearched },
    );

    if (coverage) {
      automationLogger.log(
        automation.id,
        "info",
        coverage.available === null
          ? `${label} Fetched ${coverage.fetched}; the source does not say how many exist`
          : `${label} Fetched ${coverage.fetched} of ${coverage.available} available`,
      );
    }

    // Dedup against existing jobs and within this batch.
    const existingKeys = await getExistingJobDedupeMap(automation.userId);
    const dedupedJobs = dedupeJobs(jobs, existingKeys);
    const jobsDeduplicated = dedupedJobs.length;

    automationLogger.log(
      automation.id,
      "info",
      `${label} ${jobsDeduplicated} new jobs after dedup`,
      { jobsDeduplicated },
    );

    if (jobsDeduplicated === 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} All fetched jobs already saved — nothing new to process`,
      );
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status: "completed",
        jobsSearched,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const resumeSkills = extractResumeSkills(resume);
    const skillTerms = buildSkillTerms(resume);

    // The distinct pool scoreJob actually ranks against. Surfacing it makes a
    // thin search visible instead of showing up only as an unexplained zero.
    const termCount = new Set(
      [...config.keywords, ...resumeSkills]
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ).size;
    automationLogger.log(
      automation.id,
      "info",
      `${label} Ranking against ${termCount} search term(s) (${config.keywords.length} keyword(s) + ${resumeSkills.length} resume skill(s))`,
    );

    const pipeline = runAtsPipeline(dedupedJobs, config, resumeSkills, {
      corpus: jobs,
      k: config.topK,
    });

    if (config.strictLocation && config.locations.length > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${pipeline.funnel.located} jobs remaining after strict location filter`,
      );
    }

    const capped =
      pipeline.funnel.floorSurvivors > pipeline.funnel.relevant
        ? ` (capped to ${pipeline.funnel.relevant})`
        : "";
    automationLogger.log(
      automation.id,
      "info",
      `${label} ${pipeline.funnel.floorSurvivors} jobs cleared the relevance floor${capped}`,
    );
    if (pipeline.funnel.scoreCut > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${pipeline.funnel.scoreCut} of them too weakly related to analyze — skipped`,
      );
    }
    if (pipeline.funnel.scoreFloorFailedOpen) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} No job cleared the score gate; ranked by recency instead`,
      );
    }

    const buildFunnel = (analyzed: number, highlighted: number): string => {
      const stages: FunnelStage[] = [
        { key: "fetched", label: "Fetched", count: jobsSearched },
        { key: "dedup", label: "New", count: jobsDeduplicated },
      ];
      if (pipeline.funnel.located !== null) {
        stages.push({
          key: "located",
          label: "In location",
          count: pipeline.funnel.located,
        });
      }
      stages.push({
        key: "floor",
        label: "Relevant",
        count: pipeline.funnel.relevant,
      });
      stages.push({ key: "analyzed", label: "Analyzed", count: analyzed });
      stages.push({
        key: "highlighted",
        label: "Strong match",
        count: highlighted,
      });
      return JSON.stringify(stages);
    };

    if (pipeline.funnel.relevant === 0) {
      // Re-rank the pre-dedup corpus so an exhausted board (everything that
      // matches is already saved) reads differently from a search that matches
      // nothing at all. Only pays for itself on this zero path.
      const beforeDedup = runAtsPipeline(jobs, config, resumeSkills, {
        corpus: jobs,
        k: config.topK,
      });
      let reason: string;
      if (beforeDedup.funnel.relevant > 0) {
        reason = `all ${beforeDedup.funnel.relevant} matching job(s) on these boards are already in your list — no new postings since the last run`;
      } else if (pipeline.funnel.located === 0) {
        reason = `none of the ${jobsDeduplicated} new job(s) matched your location filter (${config.locations.join(", ")})`;
      } else {
        const checked = pipeline.funnel.located ?? jobsDeduplicated;
        reason = `none of the ${checked} job(s) checked contained any of your ${termCount} search term(s)`;
      }
      automationLogger.log(
        automation.id,
        "warning",
        `${label} No relevant jobs found — ${reason}. Run complete.`,
      );
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status: "completed",
        funnelStats: buildFunnel(0, 0),
        jobsSearched,
        jobsDeduplicated,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    // Fill in what the list endpoint did not carry — descriptions, dates,
    // employment type — on the survivors only. Boards like LinkedIn publish
    // nothing but a card in search results, and a run must cost one detail
    // request per job it will actually save, not one per job it saw. Bounded
    // by topK plus the unanalyzed tier, so at most ATS_LISTING_CAP.
    if (provider.hydrate && !signal?.aborted) {
      const survivors = [...pipeline.toAnalyze, ...pipeline.toSaveUnanalyzed];
      try {
        const filled = await provider.hydrate(
          survivors.map((s) => s.job),
          signal,
        );
        // Matched by URL, not by position: a withdrawn posting (404/410) is
        // skipped by the adapter, so the returned array is allowed to be
        // shorter than the one handed in.
        const byUrl = new Map<string, JobDetails>(
          filled.map((job) => [job.url, job]),
        );
        let hydrated = 0;
        for (const scored of survivors) {
          const job = byUrl.get(scored.job.url);
          if (!job) continue;
          scored.job = job;
          hydrated++;
        }
        automationLogger.log(
          automation.id,
          "info",
          `${label} Loaded full details for ${hydrated} of ${survivors.length} listing(s)`,
        );
      } catch (err) {
        // A failed detail pass costs descriptions, not the run: the listings
        // are already ranked and still worth saving.
        automationLogger.log(
          automation.id,
          "warning",
          `${label} Could not load full listing details: ${String(err)}`,
        );
      }
    }

    const aiSettings = await getUserAiSettings(automation.userId);
    const modelName =
      aiSettings.model || getDefaultModelForProvider(aiSettings.provider);
    const limit = getAutomationMatchLimit(aiSettings.provider);

    let jobsSaved = 0;
    let jobsTagged = 0;
    let analyzed = 0;
    let highlighted = 0;
    let belowThreshold = 0;
    let aiError: string | null = null;

    // Save the un-analyzed tier (floor survivors beyond the top-K).
    if (signal?.aborted) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} Run aborted by user`,
      );
    }
    if (config.saveUnanalyzed) {
      for (const scored of pipeline.toSaveUnanalyzed) {
        if (signal?.aborted) break;
        try {
          const { saved, tagsApplied } = await persistDiscoveredJob(
            automation,
            scored.job,
            scalePrerank(scored.score),
            {
              prerankScore: scored.score,
              prerankComponents: scored.components,
              analyzed: false,
            },
            skillTerms,
          );
          if (saved) {
            jobsSaved++;
            if (tagsApplied > 0) jobsTagged++;
          }
        } catch (err) {
          log.error("[ATS] Failed to save listing", {
            "automation.id": automation.id,
            provider: provider.label,
            error: String(err),
          });
        }
      }
    }

    // LLM-analyze the top-K.
    const totalToAnalyze = pipeline.toAnalyze.length;
    automationLogger.log(
      automation.id,
      "info",
      `${label} Running LLM analysis on top ${totalToAnalyze}...`,
    );

    const analyzeJob = async (scored: ScoredJob): Promise<void> => {
      // Queued tasks bail silently as slots free; the abort is logged once
      // after all dispatched tasks settle.
      if (signal?.aborted) return;

      const saveUnanalyzed = async () => {
        try {
          const { saved, tagsApplied } = await persistDiscoveredJob(
            automation,
            scored.job,
            scalePrerank(scored.score),
            {
              prerankScore: scored.score,
              prerankComponents: scored.components,
              analyzed: false,
            },
            skillTerms,
          );
          if (saved) {
            jobsSaved++;
            if (tagsApplied > 0) jobsTagged++;
          }
        } catch (err) {
          log.error("[ATS] Failed to save listing", {
            "automation.id": automation.id,
            provider: provider.label,
            error: String(err),
          });
        }
      };

      if (aiError) {
        await saveUnanalyzed();
        return;
      }

      automationLogger.log(
        automation.id,
        "info",
        `${label} Analyzing: ${scored.job.title} at ${scored.job.company}`,
      );

      const matchResult = await matchJobToResume(
        scored.job,
        resume,
        automation.jobBoard,
        aiSettings,
        automation.userId,
        signal,
      );

      // Abort may have fired mid-call; bail before saving this job. This
      // check must come before the failure branch below, since an aborted
      // match resolves as a non-ai_unavailable failure and would otherwise
      // incorrectly saveUnanalyzed() a cancelled run's job.
      if (signal?.aborted) return;

      if (!matchResult.success) {
        if (matchResult.error === "ai_unavailable") {
          // Only the first concurrent task to fail logs; siblings stay quiet.
          if (!aiError) {
            aiError = `AI provider (${aiSettings.provider}) is not available.`;
            automationLogger.log(automation.id, "error", aiError);
          }
        } else {
          automationLogger.log(
            automation.id,
            "warning",
            `${label} LLM match failed: ${matchResult.error}`,
          );
        }
        await saveUnanalyzed();
        return;
      }

      analyzed++;
      const isStrong = matchResult.score >= automation.matchThreshold;
      if (isStrong) highlighted++;
      else belowThreshold++;

      automationLogger.log(
        automation.id,
        isStrong ? "success" : "info",
        `${label} Analyzed ${analyzed}/${totalToAnalyze}: ${scored.job.title} — ${matchResult.score}%${isStrong ? "" : ` (below ${automation.matchThreshold}% threshold — not saved)`}`,
        { score: matchResult.score, threshold: automation.matchThreshold },
      );

      if (!isStrong) return;

      try {
        const { saved, tagsApplied } = await persistDiscoveredJob(
          automation,
          scored.job,
          matchResult.score,
          {
            ...matchResult.data,
            resumeId: resume.id,
            resumeTitle: resume.title,
            matchedAt: new Date().toISOString(),
            provider: aiSettings.provider,
            model: modelName,
            prerankScore: scored.score,
            prerankComponents: scored.components,
            analyzed: true,
          },
          skillTerms,
        );
        if (saved) {
          jobsSaved++;
          if (tagsApplied > 0) jobsTagged++;
        }
      } catch (err) {
        log.error("[ATS] Failed to save analyzed job", {
          "automation.id": automation.id,
          provider: provider.label,
          error: String(err),
        });
      }
    };

    await Promise.allSettled(
      pipeline.toAnalyze.map((scored) => limit(() => analyzeJob(scored))),
    );

    if (signal?.aborted) {
      automationLogger.log(
        automation.id,
        "warning",
        `${label} Run aborted by user`,
      );
    }

    automationLogger.log(
      automation.id,
      "success",
      `${label} LLM analysis complete (${analyzed}/${pipeline.toAnalyze.length} succeeded)`,
    );

    if (belowThreshold > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} ${belowThreshold} analyzed job(s) scored below your ${automation.matchThreshold}% threshold and were not saved`,
      );
    }

    if (jobsSaved > 0) {
      automationLogger.log(
        automation.id,
        "info",
        `${label} Tagged ${jobsTagged} of ${jobsSaved} saved job(s) with skills from your resume`,
      );
    }

    automationLogger.endRun(automation.id);

    return await finalizeRun(runId, {
      status: signal?.aborted ? "cancelled" : aiError ? "completed_with_errors" : "completed",
      errorMessage: aiError || undefined,
      funnelStats: buildFunnel(analyzed, highlighted),
      jobsSearched,
      jobsDeduplicated,
      jobsProcessed: analyzed,
      jobsMatched: highlighted,
      jobsSaved,
    });
  } catch (error) {
    // An abort surfaces here as an AbortError; finalize as cancelled, not failed.
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      automationLogger.log(automation.id, "warning", `${label} Run aborted by user`);
      automationLogger.endRun(automation.id);
      return await finalizeRun(runId, {
        status: "cancelled",
        jobsSearched: 0,
        jobsDeduplicated: 0,
        jobsProcessed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
      });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    automationLogger.log(
      automation.id,
      "error",
      `${label} Run failed: ${message}`,
    );
    automationLogger.endRun(automation.id);
    log.error("[ATS] Run failed", {
      "automation.id": automation.id,
      "run.id": runId,
      provider: provider.label,
      error: message,
    });
    return await finalizeRun(runId, {
      status: "failed",
      errorMessage: message,
      jobsSearched: 0,
      jobsDeduplicated: 0,
      jobsProcessed: 0,
      jobsMatched: 0,
      jobsSaved: 0,
    });
  }
}
