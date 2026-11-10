// Where the work is done from, read off the posting and never assumed.
//
// The AI match compares a résumé with a description, so "Senior Python
// Developer, on-site in Kochi" came back at 91%: the skills do match. Whether
// the person can take the job is a different question, and nothing asked it.
// 204 of the 264 postings scored 80+ had no workplace type from their
// collector; 71 of those said hybrid or on-site in the text, and 86 named a
// city without ever mentioning remote work.
//
// Three answers and a silence. A posting that says nothing is NOT presumed to
// be an office job — LinkedIn shows "Remote" as a badge the guest page does not
// carry — but it has not earned the top band either. See `matchCeiling`.

export type Workplace = "remote" | "hybrid" | "onsite";

// The role itself is remote, said in so many words. Checked first, because a
// remote posting still mentions the office it has: "fully remote, with an
// on-site week twice a year" is a remote job. The bare word is not on this
// list on purpose: "remote-friendly", "remote pair programming" in the
// interview section and "people post fake remote job openings in our name"
// all contain it, and none of them describes the role.
const RE_REMOTE_STATED =
  /(?:\b(?:fully|completely|entirely|permanently|full[- ]time)|100%)[- ]remote(?:ly)?\b|\bremote[- ](?:first|only)\b|\b(?:this|the|our) (?:role|position|job|team|company) is (?:fully |100% |entirely )?remote\b|\bthis is an? (?:fully |100% )?remote (?:role|position|job|opportunity|contract)\b|\blocation\s*[:–—-][^.\n]{0,40}\bremote\b|\((?:fully |100% )?remote\)|\bremote (?:within|across|anywhere|worldwide|globally)\b|work(?:ing)? from anywhere|#remote\b|полностью удал[её]нн|формат(?: работы)?\s*[:—–-]\s*(?:полностью\s+)?удал[её]нн|можно удал[её]нно|удал[её]нная работа|#?удал[её]нка/iu;
// Remote offered as one of the choices. The person takes the half they can
// do, but which half this role gets is not said, so it settles nothing.
const RE_CHOICE =
  /\b(?:hybrid|on-?site|office)\s*(?:\/|,|or|and|&)\s*(?:fully\s+)?remote\b|\bremote\s*(?:\/|,|or|and|&)\s*(?:hybrid|on-?site)\b|\bor (?:fully )?remote\b/iu;
const RE_REMOTE_WORD =
  /\bremote(?:ly)?\b|work(?:ing)? from home|\bwfh\b|удал[её]нн|дистанционн/iu;
// "Hybrid search" and "hybrid cloud" are technologies, and a posting for an AI
// engineer names them far more often than it names the working arrangement.
// Days counted either way are the same fact: "three days in the office" and
// "work from home two days a week" both describe a hybrid job.
const RE_HYBRID =
  /\bhybrid\b(?!\s+(?:search|cloud|retrieval|rag|ai|ml|architectures?|infrastructure|approach(?:es)?|models\b|systems?|deployments?|apps?|mobile|storage|encryption|databases?|environments\b))|гибрид|\bdays? (?:a|per|each) week (?:in|at|from) (?:the |our )?office|\b(?:in|at|from) (?:the |our )?office\b[^.]{0,40}\bdays? (?:a|per|each) week|\bdays? in (?:the |our )?office|\bdays?\b[^.]{0,25}\b(?:from home|remote(?:ly)?|wfh)\b|\b(?:from home|wfh)\b[^.]{0,25}\bdays?\b/iu;
const RE_ONSITE =
  /\bon-?site\b|\bin-?office\b|\boffice-based\b|(?<!\p{L})в офисе|(?<!\p{L})из офиса|формат(?: работы)?\s*[:—–-]\s*офис/iu;

/** A location label names the arrangement more often than the text does. */
function fromLabel(label: string): Workplace | null {
  // "Remote or hybrid" is a remote job: the person picks the half they can do.
  if (/\bremote\b|удал[её]нн|anywhere|worldwide/iu.test(label)) return "remote";
  if (/\bhybrid\b|гибрид/iu.test(label)) return "hybrid";
  if (/\bon-?site\b|(?<!\p{L})офис/iu.test(label)) return "onsite";
  return null;
}

/**
 * Remote, hybrid, on-site — or null when the posting does not say.
 *
 * The collector's own field wins, then the location label, then the text. In
 * the text only a statement about the role counts as remote; a bare mention of
 * the word proves nothing, though it does stop "on-site" from being read as
 * the answer ("remote, with on-site onboarding" is not an office job).
 */
export function workplace({
  workplaceType,
  location,
  description,
}: {
  workplaceType?: string | null;
  location?: string | null;
  description?: string | null;
}): Workplace | null {
  const field = String(workplaceType ?? "").toUpperCase();
  if (field === "REMOTE") return "remote";
  if (field === "HYBRID") return "hybrid";
  if (field === "ONSITE") return "onsite";

  const label = fromLabel(String(location ?? ""));
  if (label) return label;

  const text = String(description ?? "");
  if (RE_REMOTE_STATED.test(text)) return "remote";
  if (RE_CHOICE.test(text)) return null;
  if (RE_HYBRID.test(text)) return "hybrid";
  if (RE_ONSITE.test(text) && !RE_REMOTE_WORD.test(text)) return "onsite";
  return null;
}

/**
 * The most an AI match may show for a posting, by what it says about place.
 * The numbers are the edges of the bands the match prompt itself defines:
 * 80+ is "strong", below 50 is "weak".
 *
 * ponytail: constants, not profile fields — move them into the profile when
 * someone wants "hybrid in my own city is fine", which needs a list of places.
 */
export const CEILING_OPEN = 100;
/** Not proven remote, or an office that offers to move you: never "strong". */
export const CEILING_SECOND = 79;
/** An office with no way to get there: never above "weak". */
export const CEILING_CLOSED = 49;

export function matchCeiling(
  place: Workplace | null,
  moveOffered: boolean,
  remoteOnly: boolean,
): number {
  if (!remoteOnly || place === "remote") return CEILING_OPEN;
  if (place === null || moveOffered) return CEILING_SECOND;
  return CEILING_CLOSED;
}

const band = (score: number) =>
  score >= 80
    ? "strong match"
    : score >= 65
      ? "good match"
      : score >= 50
        ? "partial match"
        : "weak match";

/**
 * A stored AI score held to its ceiling, or null when nothing has to change.
 *
 * The score the model gave is kept beside the shown one as `skillsScore`, so
 * the ceiling can be lifted again — an edited profile, a fuller description
 * that turns out to say "remote" — without asking the model twice. Idempotent:
 * applying it to its own output returns null.
 */
export function ceilMatch(
  matchScore: number | null | undefined,
  matchData: string | null | undefined,
  ceiling: number | null | undefined,
): { matchScore: number; matchData: string } | null {
  if (matchScore == null) return null;
  let data: Record<string, unknown>;
  try {
    data = matchData ? JSON.parse(matchData) : {};
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  // An unanalyzed row keeps a lexical pre-rank in this column. It is an
  // internal sort key the list never shows as a percentage, not an AI score.
  if (data.analyzed === false) return null;

  const raw = typeof data.skillsScore === "number" ? data.skillsScore : matchScore;
  const shown = Math.min(raw, ceiling ?? CEILING_OPEN);
  const held = shown < raw;
  if (shown === matchScore && held === (data.skillsScore !== undefined)) return null;

  const { skillsScore: _dropped, ...rest } = data;
  return {
    matchScore: shown,
    matchData: JSON.stringify({
      ...rest,
      matchScore: shown,
      recommendation: band(shown),
      ...(held ? { skillsScore: raw } : {}),
    }),
  };
}
