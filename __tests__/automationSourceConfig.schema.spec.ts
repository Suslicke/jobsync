import { CreateAutomationSchema } from "@/models/automation.schema";

const base = {
  name: "Test",
  resumeId: "550e8400-e29b-41d4-a716-446655440000",
  matchThreshold: 80,
  scheduleHour: 8,
};

describe("CreateAutomationSchema conditional validation", () => {
  it("rejects a retired job board", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "jsearch",
      keywords: "frontend",
      location: "Canada",
    });
    expect(result.success).toBe(false);
  });

  it("greenhouse requires at least one company", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: { greenhouse: { companies: [] } },
    });
    expect(result.success).toBe(false);
  });

  it("greenhouse passes with one company and no keywords/location", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          targetTitles: ["Frontend Engineer"],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("greenhouse accepts topK within 1-50 and a saveUnanalyzed boolean", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          topK: 25,
          saveUnanalyzed: false,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("greenhouse rejects topK of 0", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          topK: 0,
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("greenhouse rejects topK of 51", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: {
          companies: [{ name: "Anthropic", token: "anthropic" }],
          topK: 51,
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("ashby requires at least one company", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "ashby",
      sourceConfig: { ashby: { companies: [] } },
    });
    expect(result.success).toBe(false);
  });

  it("ashby passes with one company", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "ashby",
      sourceConfig: {
        ashby: { companies: [{ name: "Ramp", token: "ramp" }] },
      },
    });
    expect(result.success).toBe(true);
  });

  it("smartrecruiters accepts a capitalised slug the lowercase allowlist rejects", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "smartrecruiters",
      sourceConfig: {
        smartrecruiters: {
          companies: [{ name: "Mirantis", token: "Mirantis" }],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("ashby still rejects a capitalised slug — its tokens are lowercase", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "ashby",
      sourceConfig: { ashby: { companies: [{ name: "Ramp", token: "Ramp" }] } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a token carrying a path separator on any board", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "greenhouse",
      sourceConfig: {
        greenhouse: { companies: [{ name: "Acme", token: "acme/../x" }] },
      },
    });
    expect(result.success).toBe(false);
  });
});

// One refusal per kind, in the kind's own words: "Select at least one company"
// on a feed board is advice nobody can act on.
describe("CreateAutomationSchema per-kind targets", () => {
  it("a query board needs both a search term and a geography", () => {
    const withBoth = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "linkedin",
      sourceConfig: { linkedin: { queries: ["Python"], geos: ["Canada"] } },
    });
    expect(withBoth.success).toBe(true);

    const noGeo = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "linkedin",
      sourceConfig: { linkedin: { queries: ["Python"], geos: [] } },
    });
    expect(noGeo.success).toBe(false);

    const noQuery = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "linkedin",
      sourceConfig: { linkedin: { queries: [], geos: ["Canada"] } },
    });
    expect(noQuery.success).toBe(false);
  });

  // The per-list caps are not the bound. A query board walks one search per
  // PAIR, so the schema's own maximum of ten terms and ten geographies is a
  // hundred walks — roughly three quarters of an hour of paced fetching, for a
  // form the wizard used to accept without a word.
  it("counts a query board's cost as terms x locations, not either list", () => {
    const terms = (n: number) =>
      Array.from({ length: n }, (_, i) => `term${i}`);

    const withinBudget = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "linkedin",
      sourceConfig: { linkedin: { queries: terms(6), geos: terms(4) } },
    });
    expect(withinBudget.success).toBe(true);

    const overBudget = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "linkedin",
      sourceConfig: { linkedin: { queries: terms(10), geos: terms(10) } },
    });
    expect(overBudget.success).toBe(false);
    expect(
      overBudget.error?.issues.some((i) => i.message.includes("100 searches")),
    ).toBe(true);
  });

  it("a feed board needs nothing configured — the feed is the target", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "remotive",
      sourceConfig: { remotive: {} },
    });
    expect(result.success).toBe(true);
  });

  it("carries the visa toggle on the feed config", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "arbeitnow",
      sourceConfig: { arbeitnow: { maxPages: 2, visaSponsorshipOnly: true } },
    });
    expect(result.success).toBe(true);
  });

  it("a channel board needs at least one channel", () => {
    const empty = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "telegram",
      sourceConfig: { telegram: { channels: [] } },
    });
    expect(empty.success).toBe(false);

    const one = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "telegram",
      sourceConfig: { telegram: { channels: ["job_python"] } },
    });
    expect(one.success).toBe(true);
  });

  it("keeps the base targeting fields on every kind", () => {
    const result = CreateAutomationSchema.safeParse({
      ...base,
      jobBoard: "telegram",
      sourceConfig: {
        telegram: {
          channels: ["job_python"],
          targetTitles: ["Backend Engineer"],
          keywords: ["python"],
          locations: ["Berlin"],
          strictLocation: true,
          topK: 5,
          saveUnanalyzed: false,
        },
      },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.sourceConfig?.telegram).toMatchObject({
      channels: ["job_python"],
      topK: 5,
      strictLocation: true,
    });
  });
});
