// Not "how well does this job fit" but "will my application reach a human".
//
// A perfect-stack Senior Python role sitting in an ATS queue of eight hundred
// is worth less than an average-stack post by a founder you can message today.
// Fit answers the first question and is already stored on the row; this file
// answers the second one, from the same analysis plus what the database knows
// about the row itself — a contact, a decision, when we first saw it.
//
// Three terms of the old panel's score did not come across. Post-author
// quality, the b2b flag and the "anywhere" remote scope all came from LinkedIn
// post cards, which JobSync does not collect; inventing proxies for them would
// have made the number look richer than the data behind it. What is left is
// named in `terms`, and what could not fire is named in `unknown`, because a
// low rank has to be readable as a statement about the data and not as a
// verdict about the job.

import type { FitData } from ".";
import { fingerprint } from "./profile";
import { tasteScore, type TasteWeights } from "./taste";

export type ReachTerm = { label: string; value: number };

export type ReachInput = {
  fit: FitData | null;
  title?: string | null;
  /** JobContact rows: a person to write to instead of a queue to join. */
  contacts?: number;
  /** The user has already applied to this one or passed it over. */
  decided?: boolean;
  /** When the posting was first seen. Null when nobody recorded it. */
  discoveredAt?: Date | string | null;
  /** Weights from the user's own decisions, or null while unmeasured. */
  taste?: TasteWeights | null;
  now?: number;
};

export type ReachResult = {
  score: number;
  terms: ReachTerm[];
  /** Terms that did not fire because the input is missing, not because it is zero. */
  unknown: string[];
};

/**
 * Weights. Deliberately not user-editable yet: they are one candidate's
 * opinion, and the honest place for them is the fit profile — but nothing can
 * set them there today, and an unreachable setting is worse than a constant.
 */
const W = {
  contact: 3,
  clear: 2,
  unmeasured: -1,
  visa: 1.5,
  fresh: 1,
  decided: -6,
  /** 100% of the stack is worth two points, the same as having no blockers. */
  pctDivisor: 50,
};

/** Two weeks. Past it a posting is usually filled or buried. */
export const FRESH_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Rules version. The stored score is a snapshot; bump this and every snapshot
 * expires by itself, the way `FIT_RULES_VERSION` expires every analysis.
 */
export const REACH_RULES_VERSION = 1;

/** A stored score with the reason for it and the inputs it was built from. */
export type ReachData = {
  v: number;
  /** Computed at, ISO. The tooltip must not explain a number from last week. */
  at: string;
  /** Fingerprint of the inputs; see `reachKey`. */
  key: string;
  score: number;
  terms: ReachTerm[];
  unknown: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function isFresh(discoveredAt: ReachInput["discoveredAt"], now: number): boolean | null {
  if (!discoveredAt) return null;
  const t = discoveredAt instanceof Date ? discoveredAt : new Date(discoveredAt);
  const ms = t.getTime();
  if (!Number.isFinite(ms)) return null;
  return now - ms <= FRESH_MS;
}

/**
 * How reachable this posting is. Pure: same input, same number.
 *
 * The one rule worth stating out loud is the evidence guard. In the old panel
 * the "no blockers" bonus was handed out for an empty array, and a guest
 * LinkedIn card has no description at all — so blockers were never found, and
 * "Senior Substrate Engineer" in Tokyo floated to the top of the list purely
 * because nothing was known about it. Of the rows pushed into JobSync, 1,229
 * carry no blockers and 579 of those (47%) also have `pct: null`: almost half
 * that payout would go to postings that said nothing. The bonus is earned only
 * by a posting there was something to check, and a posting there was nothing to
 * check is marked down instead.
 */
export function reachScore(input: ReachInput): ReachResult {
  const { fit } = input;
  const now = input.now ?? Date.now();
  const terms: ReachTerm[] = [];
  const unknown: string[] = [];

  // `len` is the cleaned description length the analysis actually used, so this
  // asks whether there was text to read, not whether a field was populated.
  const hasEvidence = fit != null && (fit.pct != null || (fit.len ?? 0) > 200);

  if ((input.contacts ?? 0) > 0) terms.push({ label: "live contact", value: W.contact });
  // JobContact is filled by hand today, so an empty one means "nobody looked"
  // as often as it means "nobody to write to". Absence therefore costs nothing.
  else unknown.push("contact");

  if (!hasEvidence) {
    terms.push({ label: "not measured", value: W.unmeasured });
  } else if ((fit.blockers?.length ?? 0) === 0) {
    terms.push({ label: "no blockers", value: W.clear });
  }

  if (fit?.pct != null) terms.push({ label: `${fit.pct}% stack`, value: round2(fit.pct / W.pctDivisor) });
  else unknown.push("stack share");

  // Sponsorship is a bonus and never a penalty: the regex is silent on 95% of
  // postings, so a minus for its absence would punish the silence, not the job.
  // It is deliberately outside the evidence guard above. That guard exists
  // because an EMPTY blocker list proves nothing when nothing was read; this
  // flag is the opposite kind of fact — it is only ever true because the
  // cleaned description said so, and a three-line posting that names the one
  // constraint the candidate cannot work around has earned the point.
  if (fit?.visaSponsorship) terms.push({ label: "visa", value: W.visa });

  const fresh = isFresh(input.discoveredAt, now);
  if (fresh === null) unknown.push("freshness");
  else if (fresh) terms.push({ label: "seen recently", value: W.fresh });

  if (input.decided) terms.push({ label: "already decided", value: W.decided });

  // Taste stays out until both sides of the comparison are populated; the
  // caller passes null until then, and an absent signal is not a zero one.
  if (input.taste) {
    const t = tasteScore({ fit, title: input.title }, input.taste);
    if (t.score != null)
      terms.push({
        label: t.why.length ? `taste (${t.why.join(", ")})` : "taste",
        value: round2(t.score),
      });
    else unknown.push("taste");
  } else {
    unknown.push("taste");
  }

  return {
    score: round2(terms.reduce((sum, t) => sum + t.value, 0)),
    terms,
    unknown,
  };
}

/**
 * Fingerprint of everything the score was built from, stored next to it so a
 * refresh pass can skip rows nothing has changed for.
 *
 * The analysis goes in whole, hashed. The first version stored its version and
 * its description length instead, and that is blind to the one edit the user
 * makes on purpose: saving a fit profile rewrites pct, blockers and the visa
 * flag while the rules version and the description sit still, so every key came
 * out byte-identical and the pass that `saveFitProfile` calls specifically to
 * follow the profile wrote zero rows.
 *
 * `tasteKey` fingerprints the weights themselves, for the same reason: they are
 * computed from the stored analyses of the decided jobs, so a fuller
 * description arriving on one applied job moves every other row's taste term
 * without changing how many decisions there are. Freshness is folded in as a
 * boolean because it decays on its own — without it a row that aged past the
 * window would keep yesterday's bonus forever.
 */
export function reachKey(input: ReachInput, tasteKey: string): string {
  const { fit } = input;
  return [
    REACH_RULES_VERSION,
    fit ? fingerprint(JSON.stringify(fit)) : "nofit",
    input.contacts ?? 0,
    input.decided ? 1 : 0,
    isFresh(input.discoveredAt, input.now ?? Date.now()) ?? "?",
    tasteKey,
  ].join("|");
}

export function parseReachData(raw: string | null | undefined): ReachData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ReachData) : null;
  } catch {
    return null;
  }
}

/** Stored score is stale when any input it was built from has moved. */
export function isReachStale(stored: ReachData | null, key: string): boolean {
  return !stored || stored.key !== key;
}

/** The score plus its explanation, ready to store on the job. */
export function buildReach(input: ReachInput, tasteKey: string): ReachData {
  const r = reachScore(input);
  return {
    v: REACH_RULES_VERSION,
    at: new Date(input.now ?? Date.now()).toISOString(),
    key: reachKey(input, tasteKey),
    score: r.score,
    terms: r.terms,
    unknown: r.unknown,
  };
}
