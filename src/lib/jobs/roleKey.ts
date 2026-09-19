// One opening is published under several ids, on several boards, in several
// countries, and the same role arrives from a LinkedIn card and from the
// employer's own Greenhouse board within the same run. This is the key that
// makes those one role.
//
// Moved out of lib/analytics.ts when the scraper needed it too: a third copy of
// this normalisation is verbatim the serve.mjs-vs-state.mjs failure, where the
// duplicate regex fell behind the original and a job showed twice.

// Only demonstrable noise is stripped, and the port keeps the old panel's
// narrowness on purpose: an over-eager key once collapsed Affirm's "Backend
// (Lakehouse)" and "Backend (Batch)" into one role, and a missed application is
// worse than a duplicate one being spotted twice.
const NOISE_PARENS =
  /\((remote|hybrid|on-?site|remote[^)]*|m\/w\/d|all genders|w\/m\/d|[a-z]?\d{3,}|full[- ]time|part[- ]time|contract|canada|usa|united states|uk|eu|europe|germany|emea|worldwide|global)\)/gi;

// We Work Remotely appends "($90-$170/hr)" to a title Remotive carries plain,
// and the pair showed as two roles. Only parentheticals holding a currency mark
// or a rate word go, so "(Lakehouse)" still tells two teams apart.
const PAY_PARENS =
  /\([^)]*(?:[$€£₽]|\bper (?:hour|year|annum)\b|\/\s*(?:hr|hour|yr|year)\b|\bk\s*[-–]\s*\d+\s*k\b)[^)]*\)/gi;

// Grafana Labs posts one opening as four cards — "… | Ireland | Remote",
// "… | Spain | Remote" and so on. Only a trailing location tail after a pipe is
// removed; a pipe can also separate a real qualifier.
const GEO_TAIL =
  /\s*\|\s*(remote|hybrid|on-?site|anywhere|worldwide|global|ireland|spain|sweden|uk|united kingdom|germany|france|poland|portugal|netherlands|canada|usa|united states|emea|europe|latam|india|brazil|mexico|australia|japan|apac)\b[^|]*/gi;

/**
 * Company + title reduced to letters and digits, in any alphabet. The same key
 * as the old panel's `scripts/lib/state.mjs#key`, so a role deduped there is
 * deduped here and the two tools report the same campaign.
 *
 * Letters of any script, not `[a-z0-9]`: that earlier class turned a wholly
 * Cyrillic company name into an empty key, and every such role read as one.
 */
export function roleKey(company: string | null | undefined, title: string | null | undefined): string {
  const norm = (s: string | null | undefined) =>
    String(s ?? "")
      .toLowerCase()
      .replace(NOISE_PARENS, " ")
      .replace(/[^\p{L}\p{N}]+/gu, "");
  const c = norm(company);
  let t = norm(String(title ?? "").replace(PAY_PARENS, " ").replace(GEO_TAIL, " "));
  // Some boards prefix the title with the employer ("A.Team: Senior …") and
  // some do not, so one opening arrived twice. Strip it only when something is
  // left after it.
  if (c && t.startsWith(c) && t.length > c.length) t = t.slice(c.length);
  return `${c}|${t}`;
}
