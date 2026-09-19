// A person's matching identity, folded out of their profile URL.
//
// Imported contacts arrive with the same profile written several ways: with or
// without "www.", with or without a trailing slash, with a "?originalSubdomain="
// that whoever copied the link never noticed. Matching on the name instead is
// not an option — the LinkedIn post rows the Mac collects carry 396 distinct
// names over 297 distinct profiles, so names already collide about thirty times
// and matching by name would fuse two namesakes into one person.
//
// Deliberately conservative: it folds only what never changes WHOSE profile the
// URL points at. Two spellings it fails to fold cost a duplicate contact, which
// a human can merge; two people folded together cannot be taken apart again.
export function linkedinProfileKey(url?: string | null): string {
  try {
    const parsed = new URL(String(url ?? "").trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    // A bare host is a company page or a typo, not a person: keying on it would
    // make every such contact the same contact.
    return path ? `${host}${path}` : "";
  } catch {
    return "";
  }
}
