// The finding that this file exists for: applications and passes had the SAME
// median stack share, 83%. The percentage cannot tell them apart; what is named
// can. These tests pin the two rules that make that usable — a term seen once
// is noise, and a long description must not win on length.

import { describe, expect, it } from "vitest";
import { countReasons, tasteScore, tasteWeights, type TasteRow } from "@/lib/fit/taste";
import type { FitData } from "@/lib/fit";

const row = (terms: string[], title = "Senior Backend Engineer"): TasteRow => ({
  title,
  fit: { stack: { core: terms } } as unknown as FitData,
});

describe("tasteWeights", () => {
  it("pulls toward what was applied to and away from what was passed", () => {
    const w = tasteWeights(
      [row(["django", "postgresql"]), row(["django", "redis"])],
      [row(["node.js", "graphql"]), row(["node.js", "terraform"])],
    );
    expect(w["django"]).toBeGreaterThan(0);
    expect(w["node.js"]).toBeLessThan(0);
  });

  it("ignores a term seen only once", () => {
    const w = tasteWeights([row(["django", "postgresql"])], [row(["node.js"])]);
    expect(w["postgresql"]).toBeUndefined();
    expect(w["node.js"]).toBeUndefined();
  });
});

describe("tasteScore", () => {
  const w = { django: 0.5, "node.js": -0.5 };

  it("says nothing when no known term appears", () => {
    expect(tasteScore(row(["cobol"]), w)).toMatchObject({ score: null, hits: 0 });
  });

  it("averages instead of summing, so length does not win", () => {
    const one = tasteScore(row(["django"]), w).score!;
    const many = tasteScore(row(["django", "django", "django"]), w).score!;
    // Three mentions cannot triple the verdict.
    expect(many).toBeLessThan(one * 3);
  });

  it("drops an internship hard — the stack there is identical", () => {
    const senior = tasteScore(row(["django"], "Senior Python Engineer"), w).score!;
    const intern = tasteScore(row(["django"], "Стажер Python разработчик"), w).score!;
    expect(intern).toBeLessThan(senior - 0.9);
  });
});

describe("countReasons", () => {
  it("ranks the chips by how often they were chosen", () => {
    expect(
      countReasons([["stack", "remote"], ["stack"], ["salary", "stack"]]),
    ).toEqual([
      ["stack", 3],
      ["remote", 1],
      ["salary", 1],
    ]);
  });
});
