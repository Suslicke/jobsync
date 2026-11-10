import { dismissOldDiscoveredJobs, getDiscoveredJobs } from "@/actions/automation.actions";
import { getCurrentUser } from "@/utils/user.utils";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

vi.mock("@prisma/client", () => {
  const mPrismaClient = {
    job: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    PrismaClient: vi.fn(function () {
      return mPrismaClient;
    }),
  };
});

vi.mock("@/utils/user.utils", () => ({
  getCurrentUser: vi.fn(),
}));

describe("getDiscoveredJobs status filtering", () => {
  const mockUser = { id: "user-id" };

  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentUser as any).mockResolvedValue(mockUser);
    (prisma.job.findMany as any).mockResolvedValue([]);
    (prisma.job.count as any).mockResolvedValue(0);
    (prisma.job.groupBy as any).mockResolvedValue([]);
  });

  it("filters by a single discoveryStatus", async () => {
    await getDiscoveredJobs({ discoveryStatus: "new" });

    const where = (prisma.job.findMany as any).mock.calls[0][0].where;
    expect(where.discoveryStatus).toBe("new");
  });

  it("filters by multiple discoveryStatus values using an 'in' clause", async () => {
    await getDiscoveredJobs({ discoveryStatus: ["new", "accepted"] });

    const where = (prisma.job.findMany as any).mock.calls[0][0].where;
    expect(where.discoveryStatus).toEqual({ in: ["new", "accepted"] });
  });

  it("omits the discoveryStatus filter when none is given", async () => {
    await getDiscoveredJobs({});

    const where = (prisma.job.findMany as any).mock.calls[0][0].where;
    expect(where.discoveryStatus).toBeUndefined();
  });

  it("excludes discoveryStatus from the groupBy count so counts are unaffected by the filter", async () => {
    await getDiscoveredJobs({ discoveryStatus: ["new", "accepted"] });

    const countWhere = (prisma.job.groupBy as any).mock.calls[0][0].where;
    expect(countWhere.discoveryStatus).toBeUndefined();
  });

  it("sorts by reachability with unscored rows last in both directions", async () => {
    // Half the pool arrives through automations, and the only order this view
    // offered was the AI match score that reachability exists to replace. Nulls
    // last because a row scored before the column existed has no number, and
    // SQLite reads that silence as the smallest value of all.
    await getDiscoveredJobs({ sortBy: "reach", sortOrder: "desc" });
    expect((prisma.job.findMany as any).mock.calls[0][0].orderBy).toEqual({
      reachScore: { sort: "desc", nulls: "last" },
    });

    await getDiscoveredJobs({ sortBy: "reach", sortOrder: "asc" });
    expect((prisma.job.findMany as any).mock.calls[1][0].orderBy).toEqual({
      reachScore: { sort: "asc", nulls: "last" },
    });
  });

  it("still defaults to the AI match score", async () => {
    await getDiscoveredJobs({});
    expect((prisma.job.findMany as any).mock.calls[0][0].orderBy).toEqual({
      matchScore: "desc",
    });
  });

  it("limits the list to a date range but not the per-status counts", async () => {
    const before = Date.now();
    await getDiscoveredJobs({ maxAgeDays: 7 });

    const { gte } = (prisma.job.findMany as any).mock.calls[0][0].where.discoveredAt;
    expect(before - gte.getTime()).toBeGreaterThanOrEqual(7 * 86_400_000);
    expect(before - gte.getTime()).toBeLessThan(7 * 86_400_000 + 5_000);
    expect((prisma.job.count as any).mock.calls[0][0].where.discoveredAt).toBeDefined();
    // The counts decide what the clear dialog offers for the whole automation.
    expect((prisma.job.groupBy as any).mock.calls[0][0].where.discoveredAt).toBeUndefined();
  });

  it("reads no age, or zero, as any time", async () => {
    await getDiscoveredJobs({ maxAgeDays: 0 });
    expect((prisma.job.findMany as any).mock.calls[0][0].where.discoveredAt).toBeUndefined();
  });
});

describe("dismissOldDiscoveredJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentUser as any).mockResolvedValue({ id: "user-id" });
    (prisma.job.updateMany as any).mockResolvedValue({ count: 4 });
  });

  it("dismisses only this user's unreviewed jobs past the age, and deletes nothing", async () => {
    const result = await dismissOldDiscoveredJobs({ automationId: "a-1", olderThanDays: 30 });

    expect(result).toEqual({ success: true, dismissed: 4 });
    const { where, data } = (prisma.job.updateMany as any).mock.calls[0][0];
    expect(where).toMatchObject({ userId: "user-id", automationId: "a-1", discoveryStatus: "new" });
    expect(Date.now() - where.discoveredAt.lt.getTime()).toBeGreaterThanOrEqual(30 * 86_400_000);
    expect(data).toEqual({ discoveryStatus: "dismissed" });
  });

  it("refuses an age that would sweep the whole pile", async () => {
    for (const olderThanDays of [0, -1, NaN]) {
      const result = await dismissOldDiscoveredJobs({ automationId: "a-1", olderThanDays });
      expect(result.success).toBe(false);
    }
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
  });
});
