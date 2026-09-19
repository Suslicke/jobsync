import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

vi.mock("@prisma/client", () => {
  const m = {
    automationRun: { updateMany: vi.fn() },
    automation: { count: vi.fn() },
  };
  return {
    PrismaClient: vi.fn(function () {
      return m;
    }),
  };
});

vi.mock("node-cron", () => ({
  default: { schedule: vi.fn(), validate: vi.fn(() => true) },
}));

import { reapStaleRuns } from "@/lib/scheduler";

describe("reapStaleRuns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips stale running rows to failed", async () => {
    (prisma.automationRun.updateMany as any).mockResolvedValue({ count: 2 });

    const count = await reapStaleRuns();
    expect(count).toBe(2);

    const arg = (prisma.automationRun.updateMany as any).mock.calls[0][0];
    expect(arg.where.status).toBe("running");
    expect(arg.data.status).toBe("failed");
    expect(arg.data.errorMessage).toBe("interrupted");
  });

  // Age is not death. A LinkedIn sweep of 24 keyword x geography pairs runs
  // longer than the stale cutoff, and reaping it took the automation out of
  // the partial index that allows one active run — after which "Run now"
  // started a second sweep beside the live one.
  it("judges a run by its heartbeat, not by when it started", async () => {
    (prisma.automationRun.updateMany as any).mockResolvedValue({ count: 0 });
    await reapStaleRuns();

    const { where } = (prisma.automationRun.updateMany as any).mock.calls[0][0];
    expect(where.startedAt).toBeUndefined();
    expect(where.OR[0].lastProgressAt.lt).toBeInstanceOf(Date);
    // Rows written before the heartbeat column existed carry null and keep the
    // old behaviour rather than becoming unreapable.
    expect(where.OR[1]).toMatchObject({ lastProgressAt: null });
    expect(where.OR[1].startedAt.lt).toBeInstanceOf(Date);
  });

  it("returns 0 when nothing is stale", async () => {
    (prisma.automationRun.updateMany as any).mockResolvedValue({ count: 0 });
    expect(await reapStaleRuns()).toBe(0);
  });
});
