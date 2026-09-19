import pLimit from "p-limit";
import { APP_CONSTANTS } from "@/lib/constants";
import type { AtsCompany } from "@/models/automation.model";
import type { JobDetails, ScraperResult } from "../types";
import type { ResolveResult, SearchOutcome } from "../ats/types";
import {
  ATS_TOKEN_REGEX,
  boardSlugFrom,
  errorReason,
  humanizeToken,
  runDeadline,
} from "../utils";

// Personio publishes the whole board as one XML document at
// https://<slug>.jobs.personio.de/xml — no pagination, no JSON alternative.
//
// Verified live 19.09.2026 against the `vivid` board: 22 positions, 197 KB.
//
// Parsed with regular expressions rather than an XML library, as the old
// collector did: the document has seven tags worth reading and pulling a parser
// into the dependency tree for them is not worth the weight.

const POSITION_RE = /<position>([\s\S]*?)<\/position>/g;
const DESCRIPTIONS_RE = /<jobDescriptions>([\s\S]*?)<\/jobDescriptions>/;
const SECTION_RE = /<jobDescription>([\s\S]*?)<\/jobDescription>/g;

// CDATA is unwrapped BEFORE any tag stripping, never after. Every description
// body is HTML inside CDATA, and `<![CDATA[Vivid Money S.A. is <strong>` is one
// match for a naive /<[^>]+>/ — the old collector's strip() ate the opening
// sentence of every section that way and nobody saw it, because what remained
// still read like a job ad.
function cdata(raw: string): string {
  const match = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (match ? match[1] : raw).trim();
}

// XML entities only: the surrounding values are element text, not HTML.
function xmlText(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&") // last, so it cannot undo the others
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? xmlText(match[1]) : "";
}

function allTagText(block: string, tag: string): string[] {
  return [...block.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))]
    .map((match) => xmlText(match[1]))
    .filter(Boolean);
}

export interface PersonioPosition {
  id: string;
  title: string;
  location: string;
  description: string;
  employmentType: string;
  createdAt: string;
}

// Turn one board document into positions. Exported for the fixture test — the
// parse is where this adapter can go wrong, and it is pure.
export function parsePersonioXml(xml: string): PersonioPosition[] {
  const positions: PersonioPosition[] = [];

  for (const [, block] of xml.matchAll(POSITION_RE)) {
    // The descriptions subtree is cut out before any scalar field is read.
    // <name> is BOTH the position title and the heading of every description
    // section — 154 of them for 22 jobs in one live board — so a first-match
    // pick over the whole block is a coin toss on tag order, and <office>
    // repeats inside <additionalOffices> the same way.
    const descriptions = block.match(DESCRIPTIONS_RE)?.[1] ?? "";
    const head = block.replace(DESCRIPTIONS_RE, "");
    const extraOffices = head.match(
      /<additionalOffices>([\s\S]*?)<\/additionalOffices>/,
    )?.[1];
    const scalars = head.replace(
      /<additionalOffices>[\s\S]*?<\/additionalOffices>/,
      "",
    );

    const id = tagText(scalars, "id");
    if (!id) continue;

    // Section headings are kept: "About The Role", "Your Mission",
    // "Requirements" are this job's own structure, and dropping them fuses
    // every section into one wall of text.
    const description = [...descriptions.matchAll(SECTION_RE)]
      .map(([, section]) => {
        const heading = tagText(section, "name");
        const body = cdata(
          section.match(/<value>([\s\S]*?)<\/value>/)?.[1] ?? "",
        );
        return [heading ? `<h3>${heading}</h3>` : "", body]
          .filter(Boolean)
          .join("\n");
      })
      .filter(Boolean)
      .join("\n");

    const offices = [
      tagText(scalars, "office"),
      ...(extraOffices ? allTagText(extraOffices, "office") : []),
    ].filter(Boolean);

    positions.push({
      id,
      title: tagText(scalars, "name"),
      location: Array.from(new Set(offices)).join(", "),
      description,
      // `schedule` holds "full-time"/"part-time"; `employmentType` holds
      // "permanent"/"temporary", which is the contract and not the schedule,
      // and normalizeJobType would read every temporary contract as full-time.
      employmentType: tagText(scalars, "schedule"),
      createdAt: tagText(scalars, "createdAt"),
    });
  }

  return positions;
}

function personioJobUrl(host: string, id: string): string {
  return `https://${host}/job/${id}`;
}

export function mapPersonioPosition(
  position: PersonioPosition,
  companyName: string,
  host: string,
): JobDetails {
  return {
    title: position.title,
    // Nowhere in the document — carried from the watchlist entry.
    company: companyName,
    location: position.location,
    description: position.description,
    url: personioJobUrl(host, position.id),
    postedDate: position.createdAt || undefined,
    employmentType: position.employmentType || undefined,
  };
}

async function fetchBoardXml(
  host: string,
  signal: AbortSignal,
): Promise<{ ok: true; xml: string } | { ok: false; status: number }> {
  const response = await fetch(`https://${host}/xml`, {
    signal,
    // An unknown subdomain answers 307 to https://personio.com — the product's
    // marketing site. Followed, that is a 200 HTML page with no <position> in
    // it, and a wrong slug would be reported as a board with nothing open. A
    // dead source and an empty one look identical and must be treated
    // oppositely, so the redirect is caught instead of chased.
    redirect: "manual",
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  return { ok: true, xml: await response.text() };
}

// Fetch one board. .de first, .com second: both hosts serve the same document
// for a board that has one, and each 404s for a board that lives on the other.
export async function fetchPersonioBoardJobs(
  name: string,
  token: string,
  signal?: AbortSignal,
): Promise<ScraperResult<JobDetails[]>> {
  const deadline = runDeadline(
    APP_CONSTANTS.PERSONIO_FETCH_TIMEOUT_MS,
    signal,
  );

  try {
    const hosts = [
      `${token}${APP_CONSTANTS.PERSONIO_BOARD_SUFFIX}`,
      `${token}${APP_CONSTANTS.PERSONIO_BOARD_SUFFIX_COM}`,
    ];

    let lastStatus = 0;
    for (const host of hosts) {
      const result = await fetchBoardXml(host, deadline.signal);
      if (!result.ok) {
        lastStatus = result.status;
        continue;
      }

      // The root element is the proof that this is a board document and not
      // something served in its place. Zero positions under a real root is a
      // board with nothing open, which is a legitimate empty success.
      if (!result.xml.includes("<workzag-jobs>")) {
        return {
          success: false,
          error: {
            type: "parse",
            message: `Board '${token}' did not return a job feed`,
          },
        };
      }

      const jobs = parsePersonioXml(result.xml).map((position) =>
        mapPersonioPosition(position, name, host),
      );
      return { success: true, data: jobs };
    }

    // 429 is distinct so the run surfaces the existing "rate limited" label.
    if (lastStatus === 429) {
      return { success: false, error: { type: "rate_limited" } };
    }
    return {
      success: false,
      error: {
        type: "network",
        message: `Board '${token}' returned ${lastStatus}`,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: { type: "network", message: `Board '${token}' timed out` },
      };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: { type: "network", message } };
  } finally {
    deadline.release();
  }
}

// Board slug out of a pasted <slug>.jobs.personio.de/.com link or a bare slug,
// probed live. Without it the save boundary tested the whole URL against
// ATS_TOKEN_REGEX and answered "Paste a Personio board token" to the link the
// wizard had just asked for.
//
// The redirect is caught, not followed, for the same reason the fetch loop
// catches it: an unknown subdomain answers 307 to personio.com's marketing
// site, which is a 200 HTML page with no <position> in it — chased, a typo
// would resolve as a real board with nothing open. No company name anywhere in
// the document, so the display name is the humanized slug.
export async function resolvePersonioBoard(
  input: string,
): Promise<ResolveResult> {
  const slug = boardSlugFrom(
    input,
    /([a-z0-9_-]+)\.jobs\.personio\.(?:de|com)/i,
  );
  const token = slug?.toLowerCase();
  if (!token || !ATS_TOKEN_REGEX.test(token)) {
    return {
      success: false,
      message: "Paste a jobs.personio.de link or a board token",
    };
  }

  // .de first, .com second: both hosts serve the same document for a board that
  // has one, and each answers for a board that lives on the other.
  const hosts = [
    `${token}${APP_CONSTANTS.PERSONIO_BOARD_SUFFIX}`,
    `${token}${APP_CONSTANTS.PERSONIO_BOARD_SUFFIX_COM}`,
  ];

  try {
    for (const host of hosts) {
      const res = await fetch(`https://${host}/xml`, { redirect: "manual" });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<workzag-jobs>")) continue;
      return { success: true, name: humanizeToken(token), token };
    }
    return { success: false, message: `No Personio board found for '${token}'` };
  } catch {
    return { success: false, message: "Could not reach Personio" };
  }
}

// Fetch a watchlist in parallel (bounded concurrency) with per-token isolation.
export async function searchPersonioJobs(
  companies: AtsCompany[],
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const limit = pLimit(APP_CONSTANTS.PERSONIO_FETCH_CONCURRENCY);

  const settled = await Promise.allSettled(
    companies.map(({ name, token }) =>
      limit(() => fetchPersonioBoardJobs(name, token, signal)),
    ),
  );

  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];

  settled.forEach((result, index) => {
    const token = companies[index].token;
    if (result.status === "fulfilled") {
      if (result.value.success) {
        jobs.push(...result.value.data);
      } else {
        errors.push({ token, reason: errorReason(result.value.error) });
      }
    } else {
      const reason =
        result.reason instanceof Error ? result.reason.message : "Unknown error";
      errors.push({ token, reason });
    }
  });

  return { jobs, errors };
}
