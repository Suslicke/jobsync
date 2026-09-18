"use server";
import prisma from "@/lib/db";
import { handleError } from "@/lib/utils";
import { requireUser } from "./shared";
import { revalidatePath } from "next/cache";
import { parseFitData } from "@/lib/fit";
import {
  MIN_DECISIONS,
  countReasons,
  tasteWeights,
  type TasteRow,
} from "@/lib/fit/taste";

// An application says "this will do"; a pass names a boundary. Both are stored,
// only the user's own decisions feed the taste — a rejection from a company is
// their opinion, not the user's.

const parseList = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/**
 * Record why a job was applied to, passed over or rejected.
 * `kind` is "applied", "passed" or "rejected"; `liked` and `disliked` are
 * arrays of short labels, `note` is free text.
 */
export const addJobFeedback = async (
  jobId: string,
  kind: string,
  liked?: string[],
  disliked?: string[],
  how?: string,
  note?: string,
): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    if (!["applied", "passed", "rejected"].includes(kind))
      throw new Error(`Unknown feedback kind: ${kind}`);
    const job = await prisma.job.findFirst({
      where: { id: jobId, userId: user.id },
      select: { id: true },
    });
    if (!job) throw new Error("Job not found.");

    const feedback = await prisma.jobFeedback.create({
      data: {
        jobId,
        kind,
        how: how || null,
        liked: JSON.stringify(liked ?? []),
        disliked: JSON.stringify(disliked ?? []),
        note: note || null,
      },
    });
    revalidatePath("/dashboard");
    return { success: true, data: feedback };
  } catch (error) {
    return handleError(error, "Failed to save job feedback.");
  }
};

/** Everything recorded about one job, newest first. */
export const getJobFeedback = async (jobId: string): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    const rows = await prisma.jobFeedback.findMany({
      where: { jobId, Job: { userId: user.id } },
      orderBy: { createdAt: "desc" },
    });
    return {
      success: true,
      data: rows.map((r) => ({
        ...r,
        liked: parseList(r.liked),
        disliked: parseList(r.disliked),
      })),
    };
  } catch (error) {
    return handleError(error, "Failed to load job feedback.");
  }
};

export const deleteJobFeedback = async (id: string): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    const row = await prisma.jobFeedback.findFirst({
      where: { id, Job: { userId: user.id } },
      select: { id: true },
    });
    if (!row) throw new Error("Feedback not found.");
    await prisma.jobFeedback.delete({ where: { id } });
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    return handleError(error, "Failed to delete job feedback.");
  }
};

/**
 * What the user's own decisions say about their taste: the chips they picked
 * most often, and the technologies that pull toward applying or toward passing.
 * `measured` is false until there are enough decisions to mean anything.
 */
export const getTasteSummary = async (): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    const rows = await prisma.jobFeedback.findMany({
      where: { Job: { userId: user.id } },
      select: {
        kind: true,
        liked: true,
        disliked: true,
        Job: { select: { fitData: true, JobTitle: { select: { label: true } } } },
      },
    });

    const toRow = (r: (typeof rows)[number]): TasteRow => ({
      fit: parseFitData(r.Job?.fitData),
      title: r.Job?.JobTitle?.label,
    });
    const applied = rows.filter((r) => r.kind === "applied");
    const passed = rows.filter((r) => r.kind === "passed");
    const weights = tasteWeights(applied.map(toRow), passed.map(toRow));
    const ranked = Object.entries(weights).sort((a, b) => b[1] - a[1]);

    return {
      success: true,
      data: {
        applied: applied.length,
        passed: passed.length,
        rejected: rows.filter((r) => r.kind === "rejected").length,
        // Both sides have to be populated: weights are a comparison, and
        // comparing against an empty set makes every term look positive.
        measured:
          applied.length >= MIN_DECISIONS && passed.length >= MIN_DECISIONS,
        liked: countReasons(applied.map((r) => parseList(r.liked))).slice(0, 10),
        worried: countReasons(applied.map((r) => parseList(r.disliked))).slice(0, 10),
        passReasons: countReasons(passed.map((r) => parseList(r.disliked))).slice(0, 10),
        pulls: ranked.filter(([, v]) => v > 0).slice(0, 12),
        pushes: ranked.filter(([, v]) => v < 0).slice(-12).reverse(),
      },
    };
  } catch (error) {
    return handleError(error, "Failed to compute taste summary.");
  }
};
