import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

vi.mock("@prisma/client", () => {
  const m = {
    automationRun: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    automation: { findUnique: vi.fn(), update: vi.fn() },
    resume: { findUnique: vi.fn() },
    userSettings: { findUnique: vi.fn() },
    job: { findMany: vi.fn(), create: vi.fn() },
    // Persisting a discovered job scores its reachability, which reads the
    // user's own applied/passed decisions.
    jobFeedback: { findMany: vi.fn(async () => []) },
    jobTitle: { findUnique: vi.fn(), create: vi.fn() },
    location: { findUnique: vi.fn(), create: vi.fn() },
    company: { findUnique: vi.fn(), create: vi.fn() },
    jobSource: { findUnique: vi.fn(), create: vi.fn() },
    jobStatus: { findFirst: vi.fn(), create: vi.fn() },
  };
  return {
    PrismaClient: vi.fn(function () {
      return m;
    }),
  };
});

vi.mock("@/lib/scraper/greenhouse", () => ({
  searchGreenhouseJobs: vi.fn(),
}));

vi.mock("@/lib/scraper/lever", () => ({
  searchLeverJobs: vi.fn(),
}));

// Every board the registry imports needs a mock here, or importing the runner
// pulls in the real adapter and the runner spec starts making network calls.
vi.mock("@/lib/scraper/ashby", () => ({ searchAshbyJobs: vi.fn() }));
vi.mock("@/lib/scraper/rippling", () => ({
  searchRipplingJobs: vi.fn(),
  hydrateRipplingJobs: vi.fn(),
  resolveRipplingBoard: vi.fn(),
}));
vi.mock("@/lib/scraper/workable", () => ({
  searchWorkableJobs: vi.fn(),
  hydrateWorkableJobs: vi.fn(),
  resolveWorkableBoard: vi.fn(),
}));
vi.mock("@/lib/scraper/smartrecruiters", () => ({
  searchSmartRecruitersJobs: vi.fn(),
  hydrateSmartRecruitersJobs: vi.fn(),
  resolveSmartRecruitersBoard: vi.fn(),
}));
vi.mock("@/lib/scraper/personio", () => ({
  searchPersonioJobs: vi.fn(),
  resolvePersonioBoard: vi.fn(),
}));
vi.mock("@/lib/scraper/recruitee", () => ({
  searchRecruiteeJobs: vi.fn(),
  resolveRecruiteeBoard: vi.fn(),
}));
vi.mock("@/lib/scraper/linkedin", () => ({
  searchLinkedInJobs: vi.fn(),
  hydrateLinkedInJobs: vi.fn(),
}));
vi.mock("@/lib/scraper/himalayas", () => ({ searchHimalayasJobs: vi.fn() }));
vi.mock("@/lib/scraper/arbeitnow", () => ({ searchArbeitnowJobs: vi.fn() }));
vi.mock("@/lib/scraper/remotive", () => ({ searchRemotiveJobs: vi.fn() }));
vi.mock("@/lib/scraper/workingnomads", () => ({
  searchWorkingNomadsJobs: vi.fn(),
}));
vi.mock("@/lib/scraper/jobspresso", () => ({
  searchJobspressoJobs: vi.fn(),
  hydrateJobspressoJobs: vi.fn(),
}));
vi.mock("@/lib/scraper/remotecom", () => ({
  searchRemotecomJobs: vi.fn(),
  hydrateRemotecomJobs: vi.fn(),
}));
vi.mock("@/lib/scraper/telegram", () => ({ searchTelegramChannels: vi.fn() }));

vi.mock("@/lib/api-key-resolver", () => ({
  resolveApiKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/provider-registry.server", () => ({
  PROVIDER_VERIFIERS: { ollama: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock("ai", () => ({ generateText: vi.fn() }));

vi.mock("@/lib/ai", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, getModel: vi.fn().mockResolvedValue({}) };
});

import { runAutomation } from "@/lib/scraper/runner";
import { searchGreenhouseJobs } from "@/lib/scraper/greenhouse";
import { searchLeverJobs } from "@/lib/scraper/lever";
import { hydrateLinkedInJobs, searchLinkedInJobs } from "@/lib/scraper/linkedin";
import { searchRemotiveJobs } from "@/lib/scraper/remotive";
import { searchTelegramChannels } from "@/lib/scraper/telegram";
import { generateText } from "ai";
import type { Automation } from "@/models/automation.model";

function makeJob(title: string, description = "", extra = {}) {
  return {
    title,
    company: "Acme",
    location: "Remote",
    description,
    url: `https://jobs.lever.co/acme/${Math.random()}`,
    postedDate: "2026-06-01T00:00:00Z",
    ...extra,
  };
}

const leverAutomation: Automation = {
  id: "auto-lever",
  userId: "user1",
  name: "Lever",
  jobBoard: "lever",
  keywords: "",
  location: "",
  sourceConfig: JSON.stringify({
    lever: {
      companies: [{ name: "Acme", token: "acme", host: "eu" }],
      targetTitles: ["Frontend Engineer"],
      keywords: [],
      locations: [],
      strictLocation: false,
    },
  }),
  resumeId: "resume1",
  matchThreshold: 80,
  scheduleHour: 8,
  nextRunAt: null,
  lastRunAt: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Shared by both describes so the second one is not quietly relying on mock
// state the first one happened to leave behind.
function setupPrismaMocks() {
    vi.clearAllMocks();

    (prisma.automationRun.create as any).mockResolvedValue({ id: "run1" });
    (prisma.automationRun.update as any).mockResolvedValue({
      id: "run1",
      automationId: "auto-lever",
    });
    (prisma.automation.findUnique as any).mockResolvedValue({ scheduleHour: 8 });
    (prisma.automation.update as any).mockResolvedValue({});
    (prisma.userSettings.findUnique as any).mockResolvedValue(null);
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [],
    });
    (prisma.job.findMany as any).mockResolvedValue([]);
    (prisma.job.create as any).mockResolvedValue({});
    (prisma.jobTitle.findUnique as any).mockResolvedValue({ id: "jt" });
    (prisma.location.findUnique as any).mockResolvedValue({ id: "loc" });
    (prisma.company.findUnique as any).mockResolvedValue({ id: "co" });
    (prisma.jobSource.findUnique as any).mockResolvedValue({ id: "src" });
    (prisma.jobStatus.findFirst as any).mockResolvedValue({ id: "st" });

    (generateText as any).mockResolvedValue({
      text: "SCORES: match=90 recommendation=strong match\n\n## Summary\nGreat fit",
    });
}

describe("runAutomation (lever)", () => {
  beforeEach(setupPrismaMocks);

  it("dispatches to the Lever provider (reads the lever config key), not Greenhouse", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });

    const result = await runAutomation(leverAutomation);

    expect(result.status).toBe("completed");
    expect((searchLeverJobs as any).mock.calls.length).toBe(1);
    expect((searchGreenhouseJobs as any).mock.calls.length).toBe(0);
    // The lever config's companies (with host) are passed through.
    expect((searchLeverJobs as any).mock.calls[0][0]).toEqual([
      { name: "Acme", token: "acme", host: "eu" },
    ]);
    expect(result.jobsSaved).toBe(1);
  });

  it("does not save an analyzed job scoring below the match threshold", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });
    (generateText as any).mockResolvedValue({
      text: "SCORES: match=40 recommendation=weak match\n\n## Summary\nThin fit",
    });

    const result = await runAutomation(leverAutomation);

    expect(result.status).toBe("completed");
    expect(result.jobsProcessed).toBe(1); // analyzed
    expect(result.jobsMatched).toBe(0);
    expect(result.jobsSaved).toBe(0);
    expect((prisma.job.create as any).mock.calls.length).toBe(0);
  });

  it("persists Lever's workplaceType through to the job record", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React", { workplaceType: "HYBRID" })],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect(createArg.data.workplaceType).toBe("HYBRID");
  });

  it("fails cleanly with no_targets when the lever config is empty", async () => {
    const auto = {
      ...leverAutomation,
      sourceConfig: JSON.stringify({ lever: { companies: [] } }),
    };

    const result = await runAutomation(auto);
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("no_targets");
    expect((searchLeverJobs as any).mock.calls.length).toBe(0);
  });

  it("fails with all_sources_failed when every board errored and nothing came back", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [],
      errors: [{ token: "acme", reason: "returned 500" }],
    });

    const result = await runAutomation(leverAutomation);

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("all_sources_failed");
  });

  it("still completes when a board errored but other jobs arrived", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [{ token: "beta", reason: "returned 404" }],
    });

    const result = await runAutomation(leverAutomation);

    expect(result.status).toBe("completed");
    expect(result.jobsSaved).toBe(1);
  });

  it("strips HTML and decodes entities from the resume before matching", async () => {
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [
        {
          sectionType: "experience",
          workExperiences: [
            {
              description: "<p>Sales &amp; Marketing</p>",
              startDate: new Date("2020-01-01"),
              endDate: null,
              Company: { label: "Acme" },
              jobTitle: { label: "Engineer" },
              location: { label: "Remote" },
            },
          ],
        },
      ],
    });
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const prompt = (generateText as any).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Sales & Marketing");
    expect(prompt).not.toContain("&amp;");
    expect(prompt).not.toContain("<p>");
  });

  it("tags a saved job with the resume skills its posting mentions", async () => {
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: "resume1",
      title: "My Resume",
      ContactInfo: null,
      ResumeSections: [
        {
          sectionType: "skills",
          skills: [
            { category: null, order: 0, Tag: { id: "tag-react", label: "React" } },
            { category: null, order: 1, Tag: { id: "tag-rust", label: "Rust" } },
          ],
        },
      ],
    });
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "We build with React every day")],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect(createArg.data.tags).toEqual({ connect: [{ id: "tag-react" }] });
  });

  it("omits tags when the resume has no skills section", async () => {
    (searchLeverJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "We build with React every day")],
      errors: [],
    });

    await runAutomation(leverAutomation);

    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect("tags" in createArg.data).toBe(false);
  });
});

// The three kinds the company boards never exercised: the runner has to pick
// the search argument from the board's kind, and getting that wrong is silent
// — the adapter simply receives an object it does not read.
describe("runAutomation (non-company kinds)", () => {
  const base = {
    ...leverAutomation,
    id: "auto-other",
    jobBoard: "lever" as Automation["jobBoard"],
  };

  beforeEach(() => {
    setupPrismaMocks();
    (searchLinkedInJobs as any).mockResolvedValue({ jobs: [], errors: [] });
    (searchRemotiveJobs as any).mockResolvedValue({ jobs: [], errors: [] });
    (searchTelegramChannels as any).mockResolvedValue({ jobs: [], errors: [] });
  });

  it("hands a query board its queries and geographies, not a company list", async () => {
    (searchLinkedInJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });

    await runAutomation({
      ...base,
      jobBoard: "linkedin" as Automation["jobBoard"],
      sourceConfig: JSON.stringify({
        linkedin: {
          queries: ["Python Engineer"],
          geos: ["Canada"],
          targetTitles: ["Frontend Engineer"],
        },
      }),
    });

    expect((searchLinkedInJobs as any).mock.calls[0][0]).toEqual({
      queries: ["Python Engineer"],
      geos: ["Canada"],
    });
  });

  it("runs a feed board with no targets configured at all", async () => {
    (searchRemotiveJobs as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });

    const result = await runAutomation({
      ...base,
      jobBoard: "remotive" as Automation["jobBoard"],
      sourceConfig: JSON.stringify({
        remotive: { targetTitles: ["Frontend Engineer"] },
      }),
    });

    expect(result.status).toBe("completed");
    expect((searchRemotiveJobs as any).mock.calls[0][0].maxPages).toBeGreaterThan(0);
  });

  it("hands a channel board its channel list", async () => {
    (searchTelegramChannels as any).mockResolvedValue({
      jobs: [makeJob("Frontend Engineer", "React")],
      errors: [],
    });

    await runAutomation({
      ...base,
      jobBoard: "telegram" as Automation["jobBoard"],
      sourceConfig: JSON.stringify({
        telegram: {
          channels: ["job_python"],
          targetTitles: ["Frontend Engineer"],
        },
      }),
    });

    expect((searchTelegramChannels as any).mock.calls[0][0]).toEqual({
      channels: ["job_python"],
    });
  });

  it("refuses a query board with terms but no geography", async () => {
    const result = await runAutomation({
      ...base,
      jobBoard: "linkedin" as Automation["jobBoard"],
      sourceConfig: JSON.stringify({
        linkedin: { queries: ["Python Engineer"], geos: [] },
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("no_targets");
    expect((searchLinkedInJobs as any).mock.calls.length).toBe(0);
  });

  // Goes through the registry's own entry rather than bolting a hook onto it:
  // the earlier version assigned ATS_PROVIDERS.linkedin.hydrate by hand and
  // deleted it afterwards, which is exactly why five adapters could ship with a
  // hydrate nobody had wired and the suite still passed.
  it("applies a provider's hydrate pass to the survivors before saving", async () => {
    const card = makeJob("Frontend Engineer", "React");
    (searchLinkedInJobs as any).mockResolvedValue({ jobs: [card], errors: [] });
    (hydrateLinkedInJobs as any).mockImplementation(async (jobs: any[]) =>
      jobs.map((j) => ({ ...j, description: "the full posting text" })),
    );

    await runAutomation({
      ...base,
      jobBoard: "linkedin" as Automation["jobBoard"],
      sourceConfig: JSON.stringify({
        linkedin: {
          queries: ["Python"],
          geos: ["Canada"],
          targetTitles: ["Frontend Engineer"],
        },
      }),
    });

    expect(hydrateLinkedInJobs).toHaveBeenCalled();
    const createArg = (prisma.job.create as any).mock.calls[0][0];
    expect(createArg.data.description).toBe("the full posting text");
  });

  // normalizeJobUrl("") is "", and the partial unique index on (userId, jobUrl)
  // treats "" as a value — so the first link-less job a user saves makes every
  // later one fail with P2002, which persistDiscoveredJob swallows as
  // saved:false with no log line anywhere.
  it("drops postings with no URL instead of saving them under an empty one", async () => {
    (searchRemotiveJobs as any).mockResolvedValue({
      jobs: [
        makeJob("Backend Engineer", "Python", { url: "" }),
        makeJob("Backend Engineer II", "Python"),
      ],
      errors: [],
    });

    await runAutomation({
      ...base,
      jobBoard: "remotive" as Automation["jobBoard"],
      sourceConfig: JSON.stringify({
        remotive: { targetTitles: ["Backend Engineer"] },
      }),
    });

    const urls = (prisma.job.create as any).mock.calls.map(
      (c: any) => c[0].data.jobUrl,
    );
    expect(urls).not.toContain("");
    expect(urls.length).toBe(1);
  });
});
