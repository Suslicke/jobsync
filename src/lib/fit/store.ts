import "server-only";
import prisma from "@/lib/db";
import { analyseJob, isFitStale, mergeProfile, parseFitData, type FitProfile } from ".";

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
      if (!isFitStale(parseFitData(job.fitData), job.description)) continue;
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
