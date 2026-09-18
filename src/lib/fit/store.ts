import "server-only";
import prisma from "@/lib/db";
import {
  analyseJob,
  fingerprint,
  isFitStale,
  mergeProfile,
  parseFitData,
  type FitProfile,
} from ".";
import { buildReach, isReachStale, parseReachData, type ReachInput } from "./reach";
import { MIN_DECISIONS, tasteWeights, type TasteRow, type TasteWeights } from "./taste";

// The profile lives in UserSettings under `fit`, so it needs no table of its
// own and travels with the existing settings backup.
// ponytail: no cache — one indexed lookup per job write is cheaper than a
// stale profile after the user edits it.
export async function getFitProfile(userId: string): Promise<FitProfile> {
  const row = await prisma.userSettings.findUnique({ where: { userId } });
  if (!row) return mergeProfile(null);
  try {
    const settings = JSON.parse(row.settings) as { fit?: Partial<FitProfile> };
    return mergeProfile(settings?.fit);
  } catch {
    return mergeProfile(null);
  }
}

/** Analysis of one posting, ready to store in `Job.fitData`. */
export async function buildFitData(
  userId: string,
  job: { title?: string | null; description?: string | null },
): Promise<string> {
  const profile = await getFitProfile(userId);
  return JSON.stringify(
    analyseJob({ title: job.title ?? "", description: job.description ?? "" }, profile),
  );
}

/**
 * Recompute one job's analysis. Used after a description changes and by the
 * backfill; safe to call on a job that has no description yet.
 */
export async function refreshJobFit(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, description: true, JobTitle: { select: { label: true } } },
  });
  if (!job) return;
  const fitData = await buildFitData(job.userId, {
    title: job.JobTitle?.label,
    description: job.description,
  });
  await prisma.job.update({ where: { id: job.id }, data: { fitData } });
  // Reachability is built on the analysis, so it cannot outlive it: a fuller
  // description moves the stack share and may clear or add a blocker.
  await refreshJobReach(jobId);
}

/**
 * The taste weights, a fingerprint of them, and the jobs already decided about.
 *
 * One query serves all three because they come from the same rows. A rejection
 * is the company's decision, not the user's, so it feeds none of them.
 *
 * Both kinds of decision go into `decidedJobIds`, and they must: the "already
 * decided" term is what clears a job off the top of the list once it has been
 * dealt with, but `Job.applied` is set only by a status change, while the menu
 * item "I applied…" and the MCP import both write nothing but the feedback row.
 * Passes sank correctly and applications did not — including all 28 imported
 * from the old panel, each of which kept its green badge and its place at the
 * top of the reachable list for good.
 */
async function getTasteContext(userId: string): Promise<{
  weights: TasteWeights | null;
  key: string;
  decidedJobIds: Set<string>;
}> {
  const rows = await prisma.jobFeedback.findMany({
    where: { Job: { userId }, kind: { in: ["applied", "passed"] } },
    select: {
      jobId: true,
      kind: true,
      Job: { select: { fitData: true, JobTitle: { select: { label: true } } } },
    },
  });
  const toRow = (r: (typeof rows)[number]): TasteRow => ({
    fit: parseFitData(r.Job?.fitData),
    title: r.Job?.JobTitle?.label,
  });
  const applied = rows.filter((r) => r.kind === "applied");
  const passed = rows.filter((r) => r.kind === "passed");
  const measured =
    applied.length >= MIN_DECISIONS && passed.length >= MIN_DECISIONS;
  const weights = measured ? tasteWeights(applied.map(toRow), passed.map(toRow)) : null;
  return {
    weights,
    // The weights themselves, not the size of the sample they came from: they
    // are read out of the decided jobs' stored analyses, so one of those being
    // re-analysed moves every row's taste term while the counts stand still.
    // "none" while unmeasured is not a shortcut — no row carries a taste term
    // then, so nothing to rescore until the threshold is crossed.
    key: weights ? fingerprint(JSON.stringify(Object.entries(weights).sort())) : "none",
    decidedJobIds: new Set(rows.map((r) => r.jobId)),
  };
}

/** Everything one job's reach is scored from, in one lookup. */
const REACH_SELECT = {
  id: true,
  userId: true,
  applied: true,
  discoveredAt: true,
  fitData: true,
  reachData: true,
  JobTitle: { select: { label: true } },
  _count: { select: { contactLinks: true } },
} as const;

function reachInput(
  job: {
    applied: boolean;
    discoveredAt: Date | null;
    fitData: string | null;
    JobTitle?: { label: string } | null;
    _count: { contactLinks: number };
  },
  decided: boolean,
  weights: TasteWeights | null,
): ReachInput {
  return {
    fit: parseFitData(job.fitData),
    title: job.JobTitle?.label,
    contacts: job._count.contactLinks,
    decided,
    // Never `createdAt`: `updateJob` sets it to now on every edit, so editing a
    // year-old posting would promote it to the top of the reachable list.
    discoveredAt: job.discoveredAt,
    taste: weights,
  };
}

/**
 * Reach for a row being created, from the analysis just built for it. A row
 * that has never existed has no contact and no decision, and the only thing
 * still worth a lookup is the taste sample.
 *
 * Written at insert time rather than left to the scheduled pass: a job created
 * now would otherwise carry no score for up to an hour, and an unscored row
 * sorts to the bottom of the very list it was created to appear in.
 */
export async function buildInitialReach(
  userId: string,
  job: { fitData: string; title?: string | null; discoveredAt?: Date | null },
): Promise<{ reachScore: number; reachData: string }> {
  const taste = await getTasteContext(userId);
  const data = buildReach(
    {
      fit: parseFitData(job.fitData),
      title: job.title,
      contacts: 0,
      decided: false,
      discoveredAt: job.discoveredAt ?? null,
      taste: taste.weights,
    },
    taste.key,
  );
  return { reachScore: data.score, reachData: JSON.stringify(data) };
}

/** Recompute one job's reach. Cheap enough to run on a user request. */
export async function refreshJobReach(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: REACH_SELECT });
  if (!job) return;
  const taste = await getTasteContext(job.userId);
  const decided = job.applied || taste.decidedJobIds.has(job.id);
  const data = buildReach(reachInput(job, decided, taste.weights), taste.key);
  await prisma.job.update({
    where: { id: job.id },
    data: { reachScore: data.score, reachData: JSON.stringify(data) },
  });
}

/**
 * Rescore every job whose reach has moved. Returns how many rows were written.
 *
 * Separate from the fit pass and much cheaper: it never reads a description,
 * only the stored analysis. That matters because taste weights change with
 * every decision the user records, which makes every row in the table stale at
 * once — a full pass has to be affordable to run on a schedule.
 */
export async function refreshStaleReach(userId: string, batchSize = 200): Promise<number> {
  const taste = await getTasteContext(userId);
  let done = 0;
  let cursor: string | undefined;
  for (;;) {
    const jobs = await prisma.job.findMany({
      where: { userId },
      select: REACH_SELECT,
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (jobs.length === 0) break;
    cursor = jobs[jobs.length - 1].id;
    for (const job of jobs) {
      const decided = job.applied || taste.decidedJobIds.has(job.id);
      const data = buildReach(reachInput(job, decided, taste.weights), taste.key);
      if (!isReachStale(parseReachData(job.reachData), data.key)) continue;
      await prisma.job.update({
        where: { id: job.id },
        data: { reachScore: data.score, reachData: JSON.stringify(data) },
      });
      done++;
    }
  }
  return done;
}

/**
 * Recompute everything that went stale — a rules bump or an edited profile.
 * Returns how many rows were rewritten.
 */
export async function refreshStaleFits(userId: string, batchSize = 200): Promise<number> {
  const profile = await getFitProfile(userId);
  let done = 0;
  let cursor: string | undefined;
  for (;;) {
    const jobs = await prisma.job.findMany({
      where: { userId },
      select: {
        id: true,
        description: true,
        fitData: true,
        JobTitle: { select: { label: true } },
      },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (jobs.length === 0) break;
    cursor = jobs[jobs.length - 1].id;
    for (const job of jobs) {
      if (!isFitStale(parseFitData(job.fitData), job.description, profile)) continue;
      const fitData = JSON.stringify(
        analyseJob(
          { title: job.JobTitle?.label ?? "", description: job.description },
          profile,
        ),
      );
      await prisma.job.update({ where: { id: job.id }, data: { fitData } });
      done++;
    }
  }
  return done;
}
