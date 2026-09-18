// Every rule below is one the old panel learned the hard way. The first case
// is the one this file exists for: a guest LinkedIn card has no description, so
// no blocker is ever found in it, and "Senior Substrate Engineer" in Tokyo
// floated to the top of the reachable list purely because nothing was known
// about it.

import { describe, expect, it } from "vitest";
import {
  FRESH_MS,
  buildReach,
  isReachStale,
  parseReachData,
  reachKey,
  reachScore,
} from "@/lib/fit/reach";
import type { FitData } from "@/lib/fit";

const NOW = Date.UTC(2026, 8, 18);

const fit = (over: Partial<FitData> = {}): FitData =>
  ({
    v: 6,
    len: 1200,
    pct: 70,
    termsScored: 8,
    stack: { core: ["python", "fastapi"] },
    discipline: "backend",
    also: [],
    track: "ic",
    role: "yes",
    roleReason: null,
    yearsRequired: null,
    foreignStack: null,
    needLanguage: null,
    primary: "python",
    visaSponsorship: false,
    visaRefused: false,
    relocation: false,
    blockers: [],
    ...over,
  }) as FitData;

/** A posting collected without a description: nothing to measure, nothing said. */
const unmeasured = fit({ len: 0, pct: null, termsScored: 1, stack: {}, blockers: [] });

const at = (score: { terms: { label: string; value: number }[] }, label: string) =>
  score.terms.find((t) => t.label.startsWith(label));

describe("reachScore", () => {
  it("ranks an unmeasured posting below a measured one that carries a blocker", () => {
    const blind = reachScore({ fit: unmeasured, now: NOW });
    const blocked = reachScore({
      fit: fit({ pct: 40, blockers: ["mobile", "needs German"] }),
      now: NOW,
    });
    expect(blind.score).toBeLessThan(blocked.score);
    // And it says why, rather than looking clean.
    expect(at(blind, "not measured")).toBeTruthy();
    expect(at(blind, "no blockers")).toBeUndefined();
  });

  it("pays the blocker-free bonus only to a posting there was something to check", () => {
    expect(at(reachScore({ fit: fit(), now: NOW }), "no blockers")?.value).toBe(2);
    expect(at(reachScore({ fit: unmeasured, now: NOW }), "no blockers")).toBeUndefined();
  });

  it("puts a live contact above the same row without one", () => {
    const base = { fit: fit(), now: NOW };
    const withContact = reachScore({ ...base, contacts: 1 });
    expect(withContact.score).toBeGreaterThan(reachScore(base).score);
    // An empty contact column means "nobody looked" as often as "nobody to
    // write to", so the row without one is not penalised, only unexplained.
    expect(reachScore(base).unknown).toContain("contact");
  });

  it("counts taste only once it has been measured", () => {
    const row = { fit: fit(), now: NOW };
    const blind = reachScore(row);
    const tasted = reachScore({ ...row, taste: { python: 0.4, fastapi: 0.4 } });
    expect(blind.unknown).toContain("taste");
    expect(at(blind, "taste")).toBeUndefined();
    expect(tasted.score).toBeGreaterThan(blind.score);
  });

  it("rewards visa sponsorship but never punishes silence about it", () => {
    const silent = reachScore({ fit: fit(), now: NOW });
    const sponsored = reachScore({ fit: fit({ visaSponsorship: true }), now: NOW });
    expect(sponsored.score - silent.score).toBeCloseTo(1.5);
  });

  it("pays for sponsorship even in a posting too short to measure", () => {
    // The evidence guard is about what was NOT found; this flag is only ever
    // set because the description said so. "Senior Python Engineer, Berlin.
    // Visa sponsorship available." is three lines, unmeasurable, and names the
    // one constraint the candidate cannot work around.
    const short = fit({ len: 150, pct: null, termsScored: 2, visaSponsorship: true });
    expect(at(reachScore({ fit: short, now: NOW }), "visa")?.value).toBe(1.5);
    // And it is still marked down for being unmeasurable, as before.
    expect(at(reachScore({ fit: short, now: NOW }), "not measured")).toBeTruthy();
  });

  it("reads freshness from the date the posting was seen, and says so when there is none", () => {
    const fresh = reachScore({ fit: fit(), discoveredAt: new Date(NOW - 1000), now: NOW });
    const old = reachScore({
      fit: fit(),
      discoveredAt: new Date(NOW - FRESH_MS - 1000),
      now: NOW,
    });
    expect(fresh.score - old.score).toBeCloseTo(1);
    expect(reachScore({ fit: fit(), now: NOW }).unknown).toContain("freshness");
  });

  it("drops a job the user has already decided about", () => {
    const decided = reachScore({ fit: fit(), decided: true, now: NOW });
    expect(decided.score).toBeLessThan(reachScore({ fit: fit(), now: NOW }).score - 5);
  });

  it("gives a job with no analysis at all a number rather than silence", () => {
    const none = reachScore({ fit: null, now: NOW });
    expect(none.score).toBe(-1);
    expect(none.unknown).toEqual(["contact", "stack share", "freshness", "taste"]);
  });
});

describe("reachKey", () => {
  const row = { fit: fit(), contacts: 0, decided: false, now: NOW };

  it("changes when the taste weights move", () => {
    // Weights compare two whole distributions, so one changed weight moves
    // every job's score; the key is a fingerprint of them for that reason.
    expect(reachKey(row, "a1b2c3")).not.toBe(reachKey(row, "d4e5f6"));
  });

  it("changes when the analysis is rewritten without changing shape", () => {
    // What a saved fit profile does: same rules version, same description
    // length, different percentage and different blockers. Keyed on the shape
    // alone, every row came out identical and the rescoring pass wrote nothing.
    const edited = { ...row, fit: fit({ pct: 40, blockers: ["mobile"] }) };
    expect(reachKey(row, "5/5")).not.toBe(reachKey(edited, "5/5"));
  });

  it("changes when the posting ages out of the fresh window", () => {
    const fresh = { ...row, discoveredAt: new Date(NOW - 1000) };
    const old = { ...row, discoveredAt: new Date(NOW - FRESH_MS - 1000) };
    expect(reachKey(fresh, "5/5")).not.toBe(reachKey(old, "5/5"));
  });

  it("changes when a fuller description arrives", () => {
    expect(reachKey(row, "5/5")).not.toBe(reachKey({ ...row, fit: fit({ len: 4000 }) }, "5/5"));
  });
});

describe("buildReach", () => {
  it("stores the score, its terms and when it was computed", () => {
    const stored = buildReach({ fit: fit(), contacts: 1, now: NOW }, "68/16");
    expect(stored.score).toBeGreaterThan(0);
    expect(stored.at).toBe(new Date(NOW).toISOString());
    expect(isReachStale(stored, stored.key)).toBe(false);
    expect(isReachStale(stored, reachKey({ fit: fit(), contacts: 1, now: NOW }, "other"))).toBe(
      true,
    );
    expect(parseReachData(JSON.stringify(stored))).toEqual(stored);
    expect(parseReachData("not json")).toBeNull();
  });
});
