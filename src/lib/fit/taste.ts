// What the user applies to and what they pass over — from their own decisions.
//
// The observation this is built on: the median stack share of applications and
// of passes was identical, 83%. The percentage does not tell them apart at all.
// The composition does — some technologies pull toward applying, others toward
// passing. So a ranking has to look at what is named, not at how much of it is
// familiar.
//
// Weights stay unused until there are enough decisions to measure: a signal
// that has not been measured is not zero, it is absent.

import type { FitData } from ".";

/** A term seen once means nothing in a sample of fifty. */
export const MIN_SEEN = 2;
/** Smoothing: without it one pass on a rare technology gives infinite weight. */
const SMOOTH = 1;
/**
 * Below this many decisions ON EACH SIDE the taste is not measured at all.
 * Weights compare two distributions, so a hundred applications against three
 * passes measures nothing: every term the user ever applied to comes out
 * positive simply because the other side is empty.
 */
export const MIN_DECISIONS = 5;

const TIERS = ["core", "strong", "supporting", "adjacent", "alien"] as const;

export type TasteRow = { fit: FitData | null; title?: string | null };
export type TasteWeights = Record<string, number>;

function countTerms(rows: TasteRow[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of rows)
    for (const tier of TIERS)
      for (const x of r.fit?.stack?.[tier] ?? []) t[x] = (t[x] || 0) + 1;
  return t;
}

/** How characteristic each technology is of applications versus passes. */
export function tasteWeights(applied: TasteRow[], passed: TasteRow[]): TasteWeights {
  const A = countTerms(applied);
  const B = countTerms(passed);
  const na = applied.length + SMOOTH;
  const nb = passed.length + SMOOTH;
  const w: TasteWeights = {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if ((A[k] || 0) + (B[k] || 0) < MIN_SEEN) continue;
    w[k] = (A[k] || 0) / na - (B[k] || 0) / nb;
  }
  return w;
}

// "Below my level" was named three times as a pass reason, and no stack can
// catch it: an internship lists the same Python and the same Postgres. Level is
// read from the title, because that is where it is written.
const JUNIOR =
  /\b(junior|jr\.?|intern(ship)?|entry[- ]level|new grad(uate)?|graduate|trainee|apprentice|working student|werkstudent|praktikum)\b|стаж[её]р/i;
const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head of|director|architect|manager)\b/i;

export type TasteScore = { score: number | null; hits: number; why: string[] };

/** How much a posting looks like the ones that got applications. */
export function tasteScore(row: TasteRow, w: TasteWeights): TasteScore {
  let s = 0;
  let hits = 0;
  for (const tier of TIERS)
    for (const x of row.fit?.stack?.[tier] ?? []) {
      if (w[x] == null) continue;
      s += w[x];
      hits++;
    }
  if (!hits) return { score: null, hits: 0, why: [] };
  // Mean weight, not the sum: a long description must not win on length.
  let out = s / Math.sqrt(hits);
  const why: string[] = [];
  const t = String(row.title ?? "");
  // An internship is not "slightly worse", it is not the job.
  if (JUNIOR.test(t)) {
    out -= 1;
    why.push("junior");
  } else if (SENIOR.test(t)) {
    out += 0.03;
    why.push("senior");
  }
  return { score: out, hits, why };
}

/** Counts of the chips chosen, most common first. */
export function countReasons(lists: string[][]): [string, number][] {
  const c: Record<string, number> = {};
  for (const list of lists) for (const x of list) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}
