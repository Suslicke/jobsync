"use server";

import db from "@/lib/db";
import { requireUser } from "../shared";
import type {
  DiscoveredJob,
  DiscoveredOnly,
  DiscoveryStatus,
} from "@/models/automation.model";
import { APP_CONSTANTS } from "@/lib/constants";
import { formatError } from "./shared";

// Read off the stored analysis as text, the way the jobs list reads its fit
// facets: SQLite has no JSON operators worth the trouble, and these shapes are
// written by one function each. "remote" is a posting that says so itself —
// the same fact that lets its AI match reach the top band.
const ONLY: Record<DiscoveredOnly, Record<string, unknown>> = {
  remote: { fitData: { contains: '"workplace":"remote"' } },
  clear: { fitData: { contains: '"blockers":[]' } },
  scored: { matchData: { contains: '"analyzed":true' } },
  visa: { fitData: { contains: '"visaSponsorship":true' } },
};

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

// Orders the discovered pile can be read in. Reach is the point of the whole
// exercise — half the pool arrives through automations, and triaging 400 rows
// by AI match score is the ranking reachability exists to replace. Nulls last
// in both directions: a row scored before the column existed has no number, and
// SQLite would sort that silence to the top on `asc`.
const DISCOVERED_SORT = {
  matchScore: (dir: "asc" | "desc") => ({ matchScore: dir }),
  discoveredAt: (dir: "asc" | "desc") => ({ discoveredAt: dir }),
  reach: (dir: "asc" | "desc") => ({ reachScore: { sort: dir, nulls: "last" as const } }),
} as const;

export async function getDiscoveredJobs(options?: {
  automationId?: string;
  discoveryStatus?: DiscoveryStatus | DiscoveryStatus[];
  page?: number;
  limit?: number;
  sortBy?: "matchScore" | "discoveredAt" | "reach";
  sortOrder?: "asc" | "desc";
  /** Only jobs first seen within this many days. Omitted: any age. */
  maxAgeDays?: number;
  /** Every filter named here must hold. */
  only?: DiscoveredOnly[];
}): Promise<{
  success: boolean;
  data?: DiscoveredJob[];
  total?: number;
  statusCounts?: { new: number; dismissed: number; accepted: number };
  message?: string;
}> {
  try {
    const user = await requireUser();

    const {
      automationId,
      discoveryStatus,
      page = 1,
      limit = APP_CONSTANTS.RECORDS_PER_PAGE,
      sortBy = "matchScore",
      sortOrder = "desc",
      maxAgeDays,
      only,
    } = options || {};

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      userId: user.id,
      automationId: { not: null },
    };

    if (automationId) {
      where.automationId = automationId;
    }

    if (discoveryStatus) {
      where.discoveryStatus = Array.isArray(discoveryStatus)
        ? { in: discoveryStatus }
        : discoveryStatus;
    }

    // Status counts ignore the discoveryStatus filter so callers get the full
    // per-status breakdown for the whole automation, not just the current page.
    const { discoveryStatus: _omit, ...countWhere } = where;

    // Added after the counts are split off, for the same reason the status
    // filter is left out of them: the counts describe the whole automation
    // and decide what the clear dialog offers, whatever is on screen.
    if (maxAgeDays && maxAgeDays > 0) {
      where.discoveredAt = { gte: daysAgo(maxAgeDays) };
    }
    const narrowed = (only ?? []).map((key) => ONLY[key]).filter(Boolean);
    if (narrowed.length) where.AND = narrowed;

    const [jobs, total, grouped] = await Promise.all([
      db.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: (DISCOVERED_SORT[sortBy] ?? DISCOVERED_SORT.matchScore)(sortOrder),
        include: {
          automation: {
            select: { id: true, name: true },
          },
          JobTitle: { select: { label: true } },
          Company: { select: { label: true } },
          Location: { select: { label: true } },
        },
      }),
      db.job.count({ where }),
      db.job.groupBy({
        by: ["discoveryStatus"],
        where: countWhere,
        _count: true,
      }),
    ]);

    const statusCounts = { new: 0, dismissed: 0, accepted: 0 };
    for (const g of grouped) {
      if (g.discoveryStatus && g.discoveryStatus in statusCounts) {
        statusCounts[g.discoveryStatus as keyof typeof statusCounts] = g._count;
      }
    }

    return {
      success: true,
      data: jobs as unknown as DiscoveredJob[],
      total,
      statusCounts,
    };
  } catch (error) {
    return formatError(error, "Failed to get discovered jobs");
  }
}

export async function getDiscoveredJobById(id: string): Promise<{
  success: boolean;
  data?: DiscoveredJob & { parsedMatchData: object | null };
  message?: string;
}> {
  try {
    const user = await requireUser();

    const job = await db.job.findFirst({
      where: {
        id,
        userId: user.id,
        automationId: { not: null },
      },
      include: {
        automation: {
          select: { id: true, name: true },
        },
        JobTitle: { select: { label: true } },
        Company: { select: { label: true } },
        Location: { select: { label: true } },
      },
    });

    if (!job) {
      return { success: false, message: "Discovered job not found" };
    }

    let parsedMatchData = null;
    if (job.matchData) {
      try {
        parsedMatchData = JSON.parse(job.matchData);
      } catch {
        // Ignore parse errors
      }
    }

    return {
      success: true,
      data: {
        ...(job as unknown as DiscoveredJob),
        parsedMatchData,
      },
    };
  } catch (error) {
    return formatError(error, "Failed to get discovered job");
  }
}

async function setDiscoveredJobStatus(
  id: string,
  status: "accepted" | "dismissed",
): Promise<{
  success: boolean;
  data?: DiscoveredJob;
  message?: string;
}> {
  try {
    const user = await requireUser();

    const job = await db.job.findFirst({
      where: {
        id,
        userId: user.id,
        automationId: { not: null },
      },
    });

    if (!job) {
      return { success: false, message: "Discovered job not found" };
    }

    const updated = await db.job.update({
      where: { id },
      data: { discoveryStatus: status },
      include: {
        automation: {
          select: { id: true, name: true },
        },
        JobTitle: { select: { label: true } },
        Company: { select: { label: true } },
        Location: { select: { label: true } },
      },
    });

    return {
      success: true,
      data: updated as unknown as DiscoveredJob,
    };
  } catch (error) {
    return formatError(
      error,
      `Failed to ${status === "accepted" ? "accept" : "dismiss"} discovered job`,
    );
  }
}

export async function dismissDiscoveredJob(id: string): Promise<{
  success: boolean;
  data?: DiscoveredJob;
  message?: string;
}> {
  return setDiscoveredJobStatus(id, "dismissed");
}

// Bulk-dismisses the unreviewed pile past a given age. Dismissed, not deleted:
// a run recognises a posting by the rows already saved, so a deleted one that
// is still open on its board comes back on the next run as "new", dated today
// — the opposite of clearing it out. A dismissed row stays as the memory, and
// the list leaves dismissed rows out unless asked for them.
export async function dismissOldDiscoveredJobs(options: {
  /** Omitted: every automation of the user, for the combined list. */
  automationId?: string;
  olderThanDays: number;
}): Promise<{ success: boolean; dismissed?: number; message?: string }> {
  try {
    const user = await requireUser();

    const { automationId, olderThanDays } = options;
    // Without this a zero or a NaN would sweep the whole pile.
    if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
      return { success: false, message: "Age must be at least one day" };
    }

    const result = await db.job.updateMany({
      where: {
        userId: user.id,
        automationId: automationId ?? { not: null },
        discoveryStatus: "new",
        discoveredAt: { lt: daysAgo(olderThanDays) },
      },
      data: { discoveryStatus: "dismissed" },
    });

    return { success: true, dismissed: result.count };
  } catch (error) {
    return formatError(error, "Failed to dismiss old discovered jobs");
  }
}

// Accepts or dismisses a hand-picked set in one write. Only unreviewed rows
// move, as with the per-row buttons, which are not offered on anything else.
export async function setDiscoveredJobsStatus(options: {
  ids: string[];
  status: "accepted" | "dismissed";
}): Promise<{ success: boolean; updated?: number; message?: string }> {
  try {
    const user = await requireUser();

    const { ids, status } = options;
    if (status !== "accepted" && status !== "dismissed") {
      return { success: false, message: "Unknown status" };
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: true, updated: 0 };
    }

    const result = await db.job.updateMany({
      where: {
        userId: user.id,
        id: { in: ids },
        automationId: { not: null },
        discoveryStatus: "new",
      },
      data: { discoveryStatus: status },
    });

    return { success: true, updated: result.count };
  } catch (error) {
    return formatError(error, "Failed to update discovered jobs");
  }
}

// Bulk-deletes discovered jobs for one automation. Always keeps accepted jobs
// (they're tracked) and deletes dismissed ones; includeNew also clears the
// unreviewed "new" pile.
export async function clearDiscoveredJobs(options: {
  automationId: string;
  includeNew?: boolean;
}): Promise<{ success: boolean; deleted?: number; message?: string }> {
  try {
    const user = await requireUser();

    const { automationId, includeNew = false } = options;
    const statuses: DiscoveryStatus[] = includeNew
      ? ["dismissed", "new"]
      : ["dismissed"];

    const result = await db.job.deleteMany({
      where: {
        userId: user.id,
        automationId,
        discoveryStatus: { in: statuses },
      },
    });

    return { success: true, deleted: result.count };
  } catch (error) {
    return formatError(error, "Failed to clear discovered jobs");
  }
}

export async function acceptDiscoveredJob(id: string): Promise<{
  success: boolean;
  data?: DiscoveredJob;
  message?: string;
}> {
  return setDiscoveredJobStatus(id, "accepted");
}
