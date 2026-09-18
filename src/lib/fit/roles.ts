// Whether the POSTING fits the person by role is a separate question from how
// much of the stack overlaps.
//
// "DevOps & QA Engineer" asking for Python, Docker and CI/CD scores high on
// stack overlap and is still not the job being looked for. The percentage
// answers "how much of what they named do I know", not "is this my job", and
// merging the two into one number floats the wrong rows to the top.

import {
  DEFAULT_PROFILE,
  cleanText,
  listRe,
  type FitProfile,
  type SkipGroup,
} from "./profile";

export type RoleFit = { fit: "yes" | "no" | "unclear"; reason: string | null };

type CompiledRoles = {
  want: RegExp;
  wantPriority: RegExp;
  skip: [SkipGroup, RegExp][];
  foreign: { name: string; re: RegExp }[];
};
const cache = new WeakMap<FitProfile, CompiledRoles>();

function compile(profile: FitProfile): CompiledRoles {
  const cached = cache.get(profile);
  if (cached) return cached;
  const value: CompiledRoles = {
    want: listRe(profile.wantRoles),
    wantPriority: listRe(profile.wantRolesPriority),
    skip: (Object.entries(profile.skipRoles) as [SkipGroup, string[]][]).map(
      ([group, list]) => [group, listRe(list)],
    ),
    foreign: profile.foreignStacks.map((f) => ({
      name: f.name,
      re: new RegExp(f.pattern, "i"),
    })),
  };
  cache.set(profile, value);
  return value;
}

// A posting written in a script the person cannot read demands a language they
// do not speak, whether or not the text says so. For German or Spanish this was
// caught by single words ("Entwickler", "desarrollador"); for Japanese such a
// list is useless, because the WHOLE posting is in Japanese.
//
// What is measured is the share, not the presence: a lone character in brackets
// ("Backend Engineer（東京）") does not change the role.
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯ｦ-ﾟ]/g;
const READABLE = /[A-Za-zЀ-ӿ]/g;
export const FOREIGN_SCRIPT_SHARE = 0.2;

/** Share of a title written in a script the person does not read. */
export function foreignScript(title: unknown): boolean {
  const t = String(title ?? "");
  const cjk = (t.match(CJK) || []).length;
  if (!cjk) return false;
  const readable = (t.match(READABLE) || []).length;
  return cjk / (cjk + readable) > FOREIGN_SCRIPT_SHARE;
}

/**
 * 'yes'     — the person's role
 * 'no'      — someone else's role, or a foreign stack in the title
 * 'unclear' — the title resembles nothing; a human decides
 */
export function roleFit(title: unknown, profile: FitProfile = DEFAULT_PROFILE): RoleFit {
  const t = String(title ?? "");
  if (!t.trim()) return { fit: "unclear", reason: null };
  const c = compile(profile);
  const skipHit = (group: SkipGroup) => c.skip.find(([g]) => g === group)?.[1].test(t);
  // Checked BEFORE the skip lists: they contain "ml", and without this order
  // "AI/ML Engineer" was dropped whole, applied half and all.
  if (c.wantPriority.test(t) && !skipHit("research") && !skipHit("stack"))
    return { fit: "yes", reason: null };
  if (foreignScript(t)) return { fit: "no", reason: "foreign script" };
  for (const [group, re] of c.skip) if (re.test(t)) return { fit: "no", reason: group };
  return c.want.test(t) ? { fit: "yes", reason: null } : { fit: "unclear", reason: null };
}

// A requirement on the reader, not a passing mention. Two different signals say
// "this is the working language": a demand made of the person, and a statement
// of what the stack is. "Built primarily with PHP" contains no word about
// experience yet means the work is in PHP. "The Java services behind them", in
// a story about the system, means nothing of the sort.
const DEMAND =
  /\b(proven|strong|solid|deep|extensive|expert|expertise|proficien\w*|advanced|hands[- ]on|experience|years?|must have|required?|essential|fluent|mastery|built (with|on|in)|written in|our (tech )?stack|codebase (is|in)|primarily|core platform|migrating to)\b/i;
// "Nice to have: Kotlin" is not a requirement and must not drop a posting.
const OPTIONAL =
  /\b(nice to have|nice-to-have|bonus|a plus|plus points|optional|would be|desirable|preferred but|not required|advantage|familiarity)\b/i;

// ── A human language the person does not speak ──────────────────────────────
//
// This used to be caught in the TITLE only ("Entwickler", "(m/w/d)"), while the
// requirement lives in the body: "Business-level Japanese required" sits in the
// middle of a posting with a fully English title.
const LANGS: [string, RegExp][] = [
  // The right-hand boundary is mandatory. Without it "customers across Germany
  // and the DACH region" reads as a German requirement: `german` matches inside
  // `Germany`. Across 9723 descriptions that was the most common false positive.
  ["Japanese", /(?:^|[^\p{L}])(japanese|日本語)(?![\p{L}])/iu],
  ["German", /(?:^|[^\p{L}])(german|deutsch\w*)(?![\p{L}])/iu],
  ["French", /(?:^|[^\p{L}])(french|français\w*)(?![\p{L}])/iu],
  ["Spanish", /(?:^|[^\p{L}])(spanish|español\w*|castellano)(?![\p{L}])/iu],
  ["Dutch", /(?:^|[^\p{L}])(dutch|nederlands)(?![\p{L}])/iu],
  ["Italian", /(?:^|[^\p{L}])(italian|italiano)(?![\p{L}])/iu],
  ["Portuguese", /(?:^|[^\p{L}])(portuguese|português)(?![\p{L}])/iu],
  ["Polish", /(?:^|[^\p{L}])(polish|polski)(?![\p{L}])/iu],
  ["Chinese", /(?:^|[^\p{L}])(mandarin|chinese|中文)(?![\p{L}])/iu],
  ["Korean", /(?:^|[^\p{L}])(korean|한국어)(?![\p{L}])/iu],
  ["Swedish", /(?:^|[^\p{L}])(swedish|svenska)(?![\p{L}])/iu],
  ["Danish", /(?:^|[^\p{L}])(danish|dansk)(?![\p{L}])/iu],
  ["Norwegian", /(?:^|[^\p{L}])(norwegian|norsk)(?![\p{L}])/iu],
  ["Finnish", /(?:^|[^\p{L}])(finnish|suomi)(?![\p{L}])/iu],
  ["Czech", /(?:^|[^\p{L}])(czech|čeština)(?![\p{L}])/iu],
  ["Turkish", /(?:^|[^\p{L}])(turkish|türkçe)(?![\p{L}])/iu],
  ["Hebrew", /(?:^|[^\p{L}])(hebrew|עברית)(?![\p{L}])/iu],
  ["Arabic", /(?:^|[^\p{L}])(arabic|العربية)(?![\p{L}])/iu],
  ["Russian", /(?:^|[^\p{L}])(russian|русск\p{L}*)(?![\p{L}])/iu],
  ["English", /(?:^|[^\p{L}])(english)(?![\p{L}])/iu],
];

// A language named as a nice extra, or as a PERK, is not a requirement.
// "English & Spanish conversational classes" sits among the benefits, and the
// word conversational next to it makes it look exactly like a demand.
const LANG_OPTIONAL =
  /\b(nice to have|good to have|would be (?:great|nice|a plus)|an? (?:\w+ )?(?:plus|asset|advantage|merit|bonus)|is a plus|not (?:required|mandatory)|preferred but|desirable|classes|lessons|courses|training provided)\b/i;

// The name of a language is not enough: "experience with the Japanese market"
// passes any test for a requirement while being about a market. A word about
// COMMANDING the language has to stand nearby.
const SKILL =
  /\b(fluen\w+|native|mother tongue|proficien\w*|business[- ]?level|conversational|speaking|spoken|written and spoken|language skills?|verhandlungssicher\w*|muttersprach\w*|[BC][12]\s*(?:level)?|N[12]\b)\b/i;
// JLPT names itself: it needs no decoding and is confused with nothing.
const JLPT = /\bjlpt\s*[-–]?\s*n[1-3]\b/i;
const WINDOW = 70;

/** A human language demanded that the person does not speak, or null. */
export function needLanguage(
  text: unknown,
  profile: FitProfile = DEFAULT_PROFILE,
): string | null {
  const known = new Set(profile.knownLanguages.map((l) => l.toLowerCase()));
  const clean = cleanText(text);
  if (JLPT.test(clean) && !known.has("japanese")) return "Japanese";
  for (const sentence of clean.split(/[.!?\n;•·]+/)) {
    if (OPTIONAL.test(sentence) || LANG_OPTIONAL.test(sentence)) continue;
    for (const [name, re] of LANGS) {
      if (known.has(name.toLowerCase())) continue;
      const m = re.exec(sentence);
      if (!m || m.index === undefined) continue;
      const around = sentence.slice(
        Math.max(0, m.index - WINDOW),
        m.index + m[0].length + WINDOW,
      );
      if (SKILL.test(around)) return name;
    }
  }
  return null;
}

/**
 * A foreign main language demanded by the posting, or null.
 * Read sentence by sentence: a language mentioned about another team's work
 * must not cancel the posting.
 */
export function foreignStack(
  text: unknown,
  profile: FitProfile = DEFAULT_PROFILE,
): string | null {
  const c = compile(profile);
  const clean = cleanText(text);
  for (const sentence of clean.split(/[.!?\n;•·]+/)) {
    if (OPTIONAL.test(sentence) || !DEMAND.test(sentence)) continue;
    for (const f of c.foreign) if (f.re.test(sentence)) return f.name;
  }
  return null;
}
