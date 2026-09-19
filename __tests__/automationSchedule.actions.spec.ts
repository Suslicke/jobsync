import { createAutomation, updateAutomation } from "@/actions/automation.actions";
import { getCurrentUser } from "@/utils/user.utils";
import { APP_CONSTANTS } from "@/lib/constants";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

vi.mock("@prisma/client", () => {
  const mPrismaClient = {
    automation: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    resume: {
      findFirst: vi.fn(),
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

// syncSchedulerState boots node-cron and hits the DB; stub it out.
vi.mock("@/lib/scheduler", () => ({
  syncSchedulerState: vi.fn(),
}));

const RESUME_ID = "11111111-1111-4111-8111-111111111111";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test Automation",
    jobBoard: "greenhouse",
    keywords: "engineer",
    location: "New York",
    sourceConfig: {
      greenhouse: { companies: [{ name: "Anthropic", token: "anthropic" }] },
    },
    resumeId: RESUME_ID,
    matchThreshold: 80,
    scheduleHour: 8,
    ...overrides,
  } as any;
}

// One automation per hour was the old rule; several may share a slot now,
// because the scheduler runs them one after another in a sequential loop.
// An hour is only full once AUTOMATIONS_PER_HOUR_MAX sit on it.
const PER_HOUR_MAX = APP_CONSTANTS.AUTOMATIONS_PER_HOUR_MAX;

// assertScheduleCapacity counts twice: the user's total, then that hour's.
function mockCounts(total: number, atHour: number) {
  (prisma.automation.count as any)
    .mockResolvedValueOnce(total)
    .mockResolvedValueOnce(atHour);
}

describe("createAutomation schedule capacity", () => {
  const mockUser = { id: "user-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentUser as any).mockResolvedValue(mockUser);
    (prisma.resume.findFirst as any).mockResolvedValue({ id: RESUME_ID });
    (prisma.automation.create as any).mockResolvedValue({ id: "auto-1" });
  });

  it("rejects a create when the hour is already full", async () => {
    mockCounts(PER_HOUR_MAX, PER_HOUR_MAX);

    const result = await createAutomation(baseInput());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/08:00/);
    expect(prisma.automation.create).not.toHaveBeenCalled();
  });

  it("allows a second automation on an hour that already has one", async () => {
    mockCounts(1, 1);

    const result = await createAutomation(baseInput());

    expect(result.success).toBe(true);
    expect(prisma.automation.create).toHaveBeenCalled();
  });

  it("scopes the capacity check to the current user and chosen hour", async () => {
    mockCounts(1, 0);

    await createAutomation(baseInput({ scheduleHour: 14 }));

    expect((prisma.automation.count as any).mock.calls[1][0].where).toMatchObject({
      userId: "user-1",
      scheduleHour: 14,
    });
  });

  it("rejects a create when the user is at the automation limit", async () => {
    mockCounts(APP_CONSTANTS.MAX_AUTOMATIONS_PER_USER, 0);

    const result = await createAutomation(baseInput());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Maximum of/);
    expect(prisma.automation.create).not.toHaveBeenCalled();
  });

  it("creates the automation when the hour has room", async () => {
    mockCounts(1, 0);

    const result = await createAutomation(baseInput());

    expect(result.success).toBe(true);
    expect(prisma.automation.create).toHaveBeenCalled();
  });
});

describe("updateAutomation schedule capacity", () => {
  const mockUser = { id: "user-1" };
  const AUTO_ID = "auto-1";

  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentUser as any).mockResolvedValue(mockUser);
    (prisma.resume.findFirst as any).mockResolvedValue({ id: RESUME_ID });
    (prisma.automation.findFirst as any).mockResolvedValue({
      id: AUTO_ID,
      scheduleHour: 8,
    });
    (prisma.automation.update as any).mockResolvedValue({ id: AUTO_ID });
  });

  it("rejects when the target hour is already full", async () => {
    mockCounts(PER_HOUR_MAX, PER_HOUR_MAX);

    const result = await updateAutomation(AUTO_ID, baseInput({ scheduleHour: 9 }));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/09:00/);
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });

  it("excludes the automation being edited from the capacity count", async () => {
    mockCounts(1, 0);

    await updateAutomation(AUTO_ID, baseInput({ scheduleHour: 8 }));

    expect((prisma.automation.count as any).mock.calls[1][0].where).toMatchObject({
      userId: "user-1",
      scheduleHour: 8,
      id: { not: AUTO_ID },
    });
  });

  it("updates when the hour has room", async () => {
    mockCounts(1, 0);

    const result = await updateAutomation(AUTO_ID, baseInput({ scheduleHour: 10 }));

    expect(result.success).toBe(true);
    expect(prisma.automation.update).toHaveBeenCalled();
  });
});
