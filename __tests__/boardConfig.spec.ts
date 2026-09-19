import {
  parseBoardConfig,
  targetCount,
} from "@/lib/scraper/automation-run/config";
import { runAtsPipeline } from "@/lib/scraper/ats/pipeline";
import { boardById, boardLabel, boardsOfKind } from "@/lib/scraper/boards";
import { companyBoardUrl } from "@/lib/atsBoardUrl";
import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "@/lib/scraper/types";

const cfg = (value: object) => JSON.stringify(value);

describe("parseBoardConfig", () => {
  it("reads a company watchlist", () => {
    const parsed = parseBoardConfig(
      cfg({ lever: { companies: [{ name: "Acme", token: "acme" }] } }),
      "lever",
    );
    expect(parsed).toMatchObject({
      kind: "companies",
      companies: [{ name: "Acme", token: "acme" }],
    });
  });

  it("reads queries and geographies on a query board", () => {
    const parsed = parseBoardConfig(
      cfg({ linkedin: { queries: ["Python"], geos: ["Canada", "Germany"] } }),
      "linkedin",
    );
    expect(parsed).toMatchObject({
      kind: "query",
      queries: ["Python"],
      geos: ["Canada", "Germany"],
    });
  });

  it("accepts a feed board with no targets at all", () => {
    const parsed = parseBoardConfig(cfg({ remotive: {} }), "remotive");
    expect(parsed?.kind).toBe("feed");
    expect(targetCount(parsed!)).toBe(1);
  });

  it("defaults a feed's page budget rather than reading it as zero", () => {
    const parsed = parseBoardConfig(cfg({ himalayas: {} }), "himalayas");
    expect(parsed).toMatchObject({ maxPages: APP_CONSTANTS.HIMALAYAS_MAX_PAGES });
  });

  it("reads channels on a channel board", () => {
    const parsed = parseBoardConfig(
      cfg({ telegram: { channels: ["job_python", "devs_it"] } }),
      "telegram",
    );
    expect(targetCount(parsed!)).toBe(2);
  });

  it("returns null when the board has no config key at all", () => {
    expect(parseBoardConfig(cfg({ lever: {} }), "greenhouse")).toBeNull();
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseBoardConfig("{not json", "lever")).toBeNull();
  });

  it("carries the base targeting fields on every kind", () => {
    const parsed = parseBoardConfig(
      cfg({
        telegram: {
          channels: ["job_python"],
          targetTitles: ["Backend Engineer"],
          keywords: ["python"],
          locations: ["Berlin"],
          strictLocation: true,
          topK: 4,
          saveUnanalyzed: false,
        },
      }),
      "telegram",
    );
    expect(parsed).toMatchObject({
      targetTitles: ["Backend Engineer"],
      keywords: ["python"],
      locations: ["Berlin"],
      strictLocation: true,
      topK: 4,
      saveUnanalyzed: false,
    });
  });

  // A query board fans out one request per pair, so both lists must be
  // populated before there is any work — an empty geography list with ten
  // queries is zero searches, not ten.
  it("counts a query board's work as queries x geographies", () => {
    const parsed = parseBoardConfig(
      cfg({ linkedin: { queries: ["a", "b"], geos: [] } }),
      "linkedin",
    );
    expect(targetCount(parsed!)).toBe(0);
  });
});

describe("the score gate's fail-open", () => {
  const job = (title: string, description: string): JobDetails => ({
    title,
    company: "Acme",
    location: "Remote",
    description,
    url: `https://ex.com/${title}`,
  });

  // On a query or feed board every fetched job matched the user's keywords by
  // construction, so every term's idf goes to ~0 and the minimum-score gate
  // stops doing any work on every run.
  it("reports when nothing cleared the gate and ranking fell back to recency", () => {
    const jobs = [
      job("Python Engineer 1", "python python python"),
      job("Python Engineer 2", "python python python"),
      job("Python Engineer 3", "python python python"),
    ];
    const result = runAtsPipeline(
      jobs,
      {
        targetTitles: [],
        keywords: ["python"],
        locations: [],
        strictLocation: false,
      },
      [],
      { corpus: jobs },
    );

    expect(result.funnel.scoreFloorFailedOpen).toBe(true);
    // scoreCut cannot carry the same news: on this path it is 0, which reads
    // as "nothing was cut".
    expect(result.funnel.scoreCut).toBe(0);
    expect(result.funnel.relevant).toBe(3);
  });

  it("is false when something did clear the gate", () => {
    const jobs = [
      job("Platform Engineer", "kubernetes terraform grafana"),
      job("Sales Lead", "quota"),
      job("Sales Lead 2", "quota"),
      job("Sales Lead 3", "quota"),
    ];
    const result = runAtsPipeline(
      jobs,
      {
        targetTitles: [],
        keywords: ["kubernetes", "terraform", "grafana"],
        locations: [],
        strictLocation: false,
      },
      [],
      { corpus: jobs },
    );

    expect(result.funnel.scoreFloorFailedOpen).toBe(false);
  });

  it("is false when nothing cleared the relevance floor either", () => {
    const jobs = [job("Sales Lead", "quota")];
    const result = runAtsPipeline(
      jobs,
      {
        targetTitles: [],
        keywords: ["kubernetes"],
        locations: [],
        strictLocation: false,
      },
      [],
      { corpus: jobs },
    );

    expect(result.funnel.floorSurvivors).toBe(0);
    expect(result.funnel.scoreFloorFailedOpen).toBe(false);
  });
});

describe("board table lookups", () => {
  it("labels a saved job's source readably, where capitalize() could not", () => {
    expect(boardLabel("workingnomads")).toBe("Working Nomads");
    expect(boardLabel("remotecom")).toBe("Remote.com");
    expect(boardLabel("linkedin")).toBe("LinkedIn");
  });

  it("falls back to the raw id for a board that no longer exists", () => {
    expect(boardLabel("jsearch")).toBe("jsearch");
    expect(boardById("jsearch")).toBeUndefined();
  });

  it("builds a public board URL for every companies board", () => {
    boardsOfKind("companies").forEach((board) => {
      expect(companyBoardUrl(board.id, { token: "acme" })).toContain("acme");
    });
  });

  it("returns no board URL for a kind that has no per-company page", () => {
    expect(companyBoardUrl("remotive", { token: "acme" })).toBe("");
  });
});
