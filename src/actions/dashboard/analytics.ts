import prisma from "@/lib/db";
import {
  collapseRoles,
  funnelRows,
  rankLabels,
  type FunnelRow,
  type LabelBreakdown,
  type PostingRow,
  type TimePrecision,
} from "@/lib/analytics";
import { requireUser } from "../shared";

// The campaign, counted in openings rather than in rows. Everything here is an
// aggregate over the whole saved pool, so it deliberately does not go through
// getLocalDayRange: a window would answer a different question, and the day
// bucketing that does need a zone happens in the browser, in the reader's.

export interface CampaignAnalytics {
  postings: number;
  roles: number;
  /** How many postings the most-republished opening had. */
  maxPostings: number;
  companies: number;
  collection: FunnelRow[];
  responses: FunnelRow[];
  /** Applied roles the employer has since rejected, counted beside the funnel
   *  rather than inside it — see the stage comment in lib/analytics. */
  rejected: number;
  /** One entry per applied role: the instant, and how well it is known. */
  applications: { at: string | null; precision: TimePrecision | null }[];
  sources: LabelBreakdown;
  locations: LabelBreakdown;
}

const TOP_LABELS = 8;

export const getCampaignAnalytics = async (): Promise<CampaignAnalytics> => {
  const user = await requireUser();

  try {
    const jobs = await prisma.job.findMany({
      where: { userId: user.id },
      select: {
        applied: true,
        appliedDate: true,
        appliedDatePrecision: true,
        Status: { select: { value: true } },
        Company: { select: { label: true } },
        JobTitle: { select: { label: true } },
        JobSource: { select: { label: true } },
        Location: { select: { label: true } },
        _count: { select: { Feedback: true } },
      },
    });

    const postings: PostingRow[] = jobs.map((job) => ({
      company: job.Company?.label,
      title: job.JobTitle?.label,
      applied: job.applied,
      decided: job._count.Feedback > 0,
      status: job.Status?.value,
      appliedAt: job.appliedDate,
      appliedPrecision: (job.appliedDatePrecision as TimePrecision | null) ?? null,
      source: job.JobSource?.label,
      location: job.Location?.label,
    }));

    const roles = collapseRoles(postings);
    const applied = roles.filter((r) => r.applied);
    const companies = new Set(
      jobs.map((j) => j.Company?.label).filter(Boolean),
    ).size;

    // Each step is counted on the previous step's output, so the funnel can
    // only narrow: the roles are the collected postings deduped, the decided
    // are roles, and an application is a decision.
    const collection = funnelRows([
      { label: "Postings collected", count: postings.length, note: `${companies} companies` },
      {
        label: "Unique roles",
        count: roles.length,
        note:
          roles.length > 0
            ? `one opening was posted up to ${Math.max(...roles.map((r) => r.postings))} times`
            : undefined,
      },
      {
        label: "Decided",
        count: roles.filter((r) => r.decided).length,
        note: "applied to or passed over",
      },
      { label: "Applied", count: applied.length },
    ]);

    const responses = funnelRows([
      { label: "Applied", count: applied.length },
      { label: "Interview", count: applied.filter((r) => r.stage >= 1).length },
      { label: "Offer", count: applied.filter((r) => r.stage >= 2).length },
      { label: "Accepted", count: applied.filter((r) => r.stage >= 3).length },
    ]);

    return {
      postings: postings.length,
      roles: roles.length,
      maxPostings: roles.length ? Math.max(...roles.map((r) => r.postings)) : 0,
      companies,
      collection,
      responses,
      rejected: applied.filter((r) => r.rejected).length,
      applications: applied.map((r) => ({
        at: r.appliedAt ? r.appliedAt.toISOString() : null,
        precision: r.appliedPrecision,
      })),
      sources: rankLabels(
        roles.map((r) => ({ label: r.source, applied: r.applied })),
        TOP_LABELS,
      ),
      locations: rankLabels(
        roles.map((r) => ({ label: r.location, applied: r.applied })),
        TOP_LABELS,
      ),
    };
  } catch (error) {
    const msg = "Failed to compute campaign analytics";
    console.error(msg, error);
    throw new Error(msg);
  }
};
