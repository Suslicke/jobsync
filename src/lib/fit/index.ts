// One posting, taken apart: stack share, discipline, years, languages, visa.
//
// The result is stored on the job (`Job.fitData`) so the question "why is this
// row grey" has an answer without recomputing anything, and so the list can be
// filtered by it.

import {
  DEFAULT_PROFILE,
  cleanText,
  profileKey,
  type FitProfile,
  type FitTier,
} from "./profile";
import { discipline, primaryLanguage, stackFit } from "./stack";
import { outOfReach } from "./experience";
import { foreignStack, needLanguage, roleFit } from "./roles";

export * from "./profile";
export * from "./stack";
export * from "./experience";
export * from "./roles";

// Visa sponsorship and relocation help are DIFFERENT things. "Relocation
// assistance" means "we pay to move your boxes", not "we will get you a work
// permit". For someone without the right to work in the target country that is
// the difference between a job and a wasted application.
const RE_SPONSOR_YES =
  /(visa|work permit|immigration)\s+(sponsor\w*|support)|sponsor\w*\s+(your\s+)?(visa|work permit|h-?1b|employment pass)|sponsorship\s+(is\s+)?(available|provided|offered)|we\s+(can\s+|do\s+|will\s+)?sponsor\b|\blmia\b|open work permit|blue card|work authorization (is )?(provided|sponsored)/i;
const RE_SPONSOR_NO =
  /(no|not|unable to|cannot|won'?t|do not|does not)\s+((be\s+)?able to\s+)?(provide\s+|offer\s+)?(visa\s+)?sponsor|without sponsorship|sponsorship (is )?(not|un)available|must (be )?(legally )?(authorized|eligible) to work|must have (the )?(legal )?right to work|no visa sponsorship|not offering (employer )?(visa )?sponsorship/i;
const RE_RELOCATION =
  /relocation\s+(support|package|assistance|bonus|allowance)|we (help|assist) with relocation|paid relocation/i;

/** 'yes' — sponsorship named, 'no' — explicitly refused, null — not said. */
export function sponsorship(text: unknown): "yes" | "no" | null {
  const t = String(text ?? "");
  if (RE_SPONSOR_NO.test(t)) return "no";
  if (RE_SPONSOR_YES.test(t)) return "yes";
  return null;
}

/** Relocation help. Weaker than sponsorship and no substitute for it. */
export const relocation = (text: unknown) => RE_RELOCATION.test(String(text ?? ""));

// "Remote" with a US city beside it means "remote, but from the United States".
// Without the right to work there it is not a job, it is a wasted evening — and
// it reads exactly like open remote work until you look at the city. The city
// names are the load-bearing half: Wellfound writes "Remote • Palo Alto", and a
// list of country names alone would let that through.
const RE_US_PLACE =
  /united states|\bu\.?s\.?a?\b|\bus\b|new york|san francisco|bay area|silicon valley|palo alto|santa clara|mountain view|sunnyvale|menlo park|san jose|san mateo|seattle|austin|boston|chicago|denver|atlanta|los angeles|san diego|portland|miami|dallas|houston|phoenix|philadelphia|washington,? d\.?c|nyc\b|brooklyn|remote, us/i;
// A two-letter state code counts only after a comma. Bare "ON" would turn
// "hands-on" into Ontario, and "IN" every second sentence into Indiana.
const RE_US_STATE =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;

/**
 * Remote work restricted to the United States, read off the location label.
 *
 * Only the label: a description mentioning an American office says nothing
 * about where the work may be done from, and guessing there would blame the
 * posting for its address.
 */
export function usOnlyRemote(location: unknown): boolean {
  const loc = String(location ?? "");
  if (!/remote|удал/i.test(loc)) return false;
  // Said out loud that anywhere will do — the city is then a headquarters.
  if (/anywhere|worldwide|global|everywhere/i.test(loc)) return false;
  return RE_US_PLACE.test(loc) || RE_US_STATE.test(loc);
}

export type FitData = {
  v: number;
  /** Length of the cleaned description this was computed from. */
  len: number;
  /** Fingerprint of the profile this was measured against; see `isFitStale`. */
  p: string;
  /** Stack share, or null when not measured — which is not the same as zero. */
  pct: number | null;
  termsScored: number;
  stack: Partial<Record<FitTier, string[]>>;
  discipline: string;
  also: string[];
  track: string;
  role: "yes" | "no" | "unclear";
  roleReason: string | null;
  yearsRequired: number | null;
  foreignStack: string | null;
  needLanguage: string | null;
  primary: string | null;
  visaSponsorship: boolean;
  visaRefused: boolean;
  relocation: boolean;
  /** Remote, but only from inside the United States. See `usOnlyRemote`. */
  usOnlyRemote: boolean;
  /** Every reason this is not the person's job, named out loud. */
  blockers: string[];
};

/**
 * Rules version. Description length catches only one way of going stale — the
 * collector brought fuller text. It misses the other one entirely: the RULES
 * changed while the description did not. Bump this and every cached analysis
 * expires by itself.
 */
export const FIT_RULES_VERSION = 7;

/** Analysis of one posting. Pure: same input, same record. */
export function analyseJob(
  {
    title = "",
    description = "",
    location = "",
  }: { title?: string; description?: string; location?: string | null },
  profile: FitProfile = DEFAULT_PROFILE,
): FitData {
  const desc = cleanText(description);
  const text = `${title}\n${desc}`;
  const f = stackFit(text, profile);
  // Discipline is read from the body, not the title: "Software Engineer" with
  // an Expo + React Native stack is mobile work, and the title says nothing.
  const d = discipline(title, desc, profile);
  const role = roleFit(title, profile);
  const blockers: string[] = [];
  if (d.discipline !== "unknown" && !profile.targetDisciplines.includes(d.discipline))
    blockers.push(d.discipline);
  const years = outOfReach(desc, profile);
  if (years) blockers.push(`${years}y required`);
  const lang = foreignStack(desc, profile);
  // A human language is as hard a blocker as a foreign stack: no amount of
  // stack overlap opens a posting that needs a language the person lacks.
  const human = needLanguage(desc, profile);
  if (lang) blockers.push(`${lang} role`);
  if (human) blockers.push(`needs ${human}`);
  // The first language named is the language of the work. "We're using Java,
  // Go, Spring boot" starts with Java, and the order is no accident.
  const primary = primaryLanguage(text, profile);
  if (primary && !primary.mine && !blockers.includes(`${primary.name} role`))
    blockers.push(`${primary.name} first`);
  if (role.fit === "no" && role.reason) blockers.push(`title: ${role.reason}`);
  // Geography is a blocker like any other: the person cannot work in the US,
  // so a US-only remote posting is closed to them however well the stack fits.
  const usRemote = usOnlyRemote(location);
  if (usRemote) blockers.push("US-only remote");

  const sponsor = sponsorship(desc);
  return {
    v: FIT_RULES_VERSION,
    len: desc.length,
    p: profileKey(profile),
    pct: f.pct,
    termsScored: f.scored,
    stack: f.byTier,
    discipline: d.discipline,
    also: d.also,
    track: d.track,
    role: role.fit,
    roleReason: role.reason,
    yearsRequired: years ?? null,
    foreignStack: lang,
    needLanguage: human,
    primary: primary ? primary.name : null,
    visaSponsorship: sponsor === "yes",
    visaRefused: sponsor === "no",
    relocation: relocation(desc),
    usOnlyRemote: usRemote,
    blockers,
  };
}

/**
 * Stored analysis is stale when the rules change, the text changes, or the
 * profile it was measured against does. Length is enough for the second case —
 * a collector that brought a fuller description always changed it — and it
 * never goes stale on its own, so a posting nobody can measure is not
 * re-measured on every pass.
 *
 * The third case was missing and is the one the user actually triggers: moving
 * Kubernetes from adjacent to core rewrites every percentage in the table while
 * the version and the description length sit still, so "Profile saved; 0 jobs
 * re-analyzed" was the honest report of a pass that could not see its own
 * reason to run. An analysis written before `p` existed has none and is rebuilt
 * once, which is what it needs anyway.
 *
 * The location is deliberately not part of the key. It is written once when the
 * row is created, and both paths that can change it afterwards (`updateJob`,
 * `updateJobFromNames`) call `refreshJobFit`, which recomputes unconditionally.
 */
export function isFitStale(
  fit: FitData | null,
  description: string,
  profile: FitProfile,
): boolean {
  if (!fit) return true;
  if (fit.v !== FIT_RULES_VERSION) return true;
  if (fit.p !== profileKey(profile)) return true;
  return fit.len !== cleanText(description).length;
}

export function parseFitData(raw: string | null | undefined): FitData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as FitData) : null;
  } catch {
    return null;
  }
}
