// How many years of experience a posting demands.
//
// A separate question from stack overlap and from role: "15+ years in
// aeronautics engineering, including 3 as a team leader" is not a weak match,
// it is a posting the person does not qualify for at all.
//
// The naive maximum found in the text cannot be used: "we have 30 years of
// combined experience" is about the company, not about the reader. A number is
// read together with its surroundings, and the surroundings decide.

import { DEFAULT_PROFILE, type FitProfile } from "./profile";

// The sentence addresses the CANDIDATE. That is the signal: real requirements
// always have it ("You'll be a great fit if you have… 10+ years",
// "Qualifications: 10+ years"), company bragging never does. Words about
// experience alone do not separate the two — on real data that gave three
// false positives out of six.
const CANDIDATE_CTX =
  /\b(you|your|candidates?|applicants?|qualifications?|requirements?|profile|must have|minimum|at least|looking for|we (are |')?seeking|ideal|expects?|bring|hire|role requires)\b/i;

// The company talking about itself. "With over 20 years of experience … offers",
// "Here we are 25 years later", "more than 10 years … and 40 employees" all
// contain both "years" and "experience", and none is a requirement.
const SKIP_CTX =
  /\b(combined|our team|our company|we have|we've|we are|we're|us\b|founded|in business|on the market|serving|employees|offers|pioneer\w*|history|anniversary|since \d{4}|clients|group|later|industry leader)\b/i;

// A requirement bullet often has no addressee at all: "• 10+ years of
// experience developing modern web applications". A short fragment starting
// with a number of years is a requirements list, not a company story.
const BULLET =
  /^\s*(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s*\+?\s*(?:-|–|to)?\s*\d{0,2}\s*years?\b/i;

// "8-10 years" demands eight, not ten: the bar is the lower bound.
const WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const NUM = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)`;
const RE = new RegExp(
  String.raw`${NUM}\s*(?:\+|plus)?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*)?\s*(?:\+\s*)?years?\b`,
  "gi",
);

const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : (WORD[s.toLowerCase()] ?? null));

/**
 * The largest number of years demanded of the reader, or null when unsaid.
 * Numbers without a demanding context, and numbers about the company, do not count.
 */
export function yearsRequired(text: unknown): number | null {
  const s = String(text ?? "");
  if (!s.trim()) return null;
  let best: number | null = null;
  // The context is a sentence, not a window of N characters. A window crossed
  // the full stop: in "We have 30 years of combined experience. You bring 6+
  // years of Python" the word combined cancelled the real requirement.
  for (const sentence of s.replace(/<[^>]*>/g, " ").split(/[.!?\n;•·]+/)) {
    if (SKIP_CTX.test(sentence)) continue;
    if (!CANDIDATE_CTX.test(sentence) && !BULLET.test(sentence)) continue;
    let m: RegExpExecArray | null;
    RE.lastIndex = 0;
    while ((m = RE.exec(sentence))) {
      const n = toNum(m[1]);
      // Over thirty is no longer a career, it is a founding year or a typo.
      if (n == null || n < 1 || n > 30) continue;
      if (best == null || n > best) best = n;
    }
  }
  return best;
}

/**
 * A bar out of reach. Stretching a couple of years past your own is normal;
 * the profile says where stretching turns into lying about yourself.
 */
export function outOfReach(
  text: unknown,
  profile: FitProfile = DEFAULT_PROFILE,
): number | null {
  const n = yearsRequired(text);
  return n != null && n - profile.haveYears >= profile.yearsStretch ? n : null;
}
