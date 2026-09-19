/// <reference types="vite/client" />
// For import.meta.glob below: the project's tsconfig lists only
// vitest/globals and node, so Vite's own ambient types are pulled in here.
import { parseEditSourceConfig } from "@/components/automations/automation-wizard/wizardConfig";
import { BOARDS, BOARD_IDS, boardById } from "@/lib/scraper/boards";
import { ATS_PROVIDERS } from "@/lib/scraper/ats/registry";
import { SourceConfigSchema } from "@/models/automation.schema";
import type { JobBoard } from "@/models/automation.model";

describe("parseEditSourceConfig", () => {
  it("returns undefined for null/blank input", () => {
    expect(parseEditSourceConfig(null)).toBeUndefined();
    expect(parseEditSourceConfig("")).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseEditSourceConfig("{not json")).toBeUndefined();
  });

  it("keeps a Greenhouse config", () => {
    const sc = JSON.stringify({ greenhouse: { companies: [] } });
    expect(parseEditSourceConfig(sc)).toEqual({ greenhouse: { companies: [] } });
  });

  it("keeps a Lever config", () => {
    const sc = JSON.stringify({ lever: { companies: [] } });
    expect(parseEditSourceConfig(sc)).toEqual({ lever: { companies: [] } });
  });

  it("keeps an Ashby config so editing an Ashby automation keeps its companies", () => {
    const sc = JSON.stringify({
      ashby: { companies: [{ name: "Ramp", token: "ramp" }] },
    });
    expect(parseEditSourceConfig(sc)).toEqual({
      ashby: { companies: [{ name: "Ramp", token: "ramp" }] },
    });
  });

  it("keeps a LinkedIn query config", () => {
    const sc = JSON.stringify({
      linkedin: { queries: ["Python"], geos: ["Canada"] },
    });
    expect(parseEditSourceConfig(sc)).toEqual({
      linkedin: { queries: ["Python"], geos: ["Canada"] },
    });
  });

  it("keeps a feed config that carries nothing but run options", () => {
    const sc = JSON.stringify({ remotive: { maxPages: 3 } });
    expect(parseEditSourceConfig(sc)).toEqual({ remotive: { maxPages: 3 } });
  });
});

// The eleven-enumeration failure this table replaces is silent in every
// direction, so the table is checked against the two lists it cannot absorb.
describe("the board table", () => {
  it("has a display label and wizard copy for every board", () => {
    BOARDS.forEach((board) => {
      expect(board.label.length).toBeGreaterThan(0);
      expect(board.wizard.description.length).toBeGreaterThan(0);
    });
  });

  it("registers a search provider for every board — a missing one blocks the run", () => {
    BOARD_IDS.forEach((id) => {
      expect(ATS_PROVIDERS[id]).toBeDefined();
      expect(ATS_PROVIDERS[id]!.kind).toBe(boardById(id)!.kind);
    });
  });

  // The test above compares id and kind only, which is how six adapters came to
  // export a hydrate* that no registry entry carried. Nothing else in the tree
  // references those functions, so `grep hydrate src/` found the definitions,
  // the type declaration and the runner's call site — and nothing joining them.
  // A LinkedIn run then saved every posting with description "", because the
  // guest card has no body and the one pass that fetches it never fired.
  it("registers the hydrate pass of every board whose adapter exports one", async () => {
    const modules = import.meta.glob("../src/lib/scraper/*/index.ts");

    for (const [path, load] of Object.entries(modules)) {
      const id = path.split("/").at(-2) as JobBoard;
      if (!boardById(id)) continue;

      const mod = (await load()) as Record<string, unknown>;
      const exported = Object.entries(mod).find(
        ([name, value]) =>
          name.startsWith("hydrate") && typeof value === "function",
      );
      if (!exported) continue;

      expect(
        ATS_PROVIDERS[id]?.hydrate,
        `${id} exports ${exported[0]} but its ATS_PROVIDERS entry has no hydrate`,
      ).toBeDefined();
    }
  });

  it("has a sourceConfig key for every board — a missing one is stripped at save", () => {
    const shape = Object.keys(SourceConfigSchema.shape);
    BOARD_IDS.forEach((id) => expect(shape).toContain(id));
  });

  it("gives every companies board a public board URL and no other kind one", () => {
    BOARDS.forEach((board) => {
      expect(typeof board.boardUrl === "function").toBe(
        board.kind === "companies",
      );
    });
  });

  it("offers the visa filter on exactly one board", () => {
    expect(BOARDS.filter((b) => b.visaFilter).map((b) => b.id)).toEqual([
      "arbeitnow",
    ]);
  });
});
