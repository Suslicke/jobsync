"use server";

import { getCurrentUser } from "@/utils/user.utils";
import { APP_CONSTANTS } from "@/lib/constants";
import {
  ATS_TOKEN_REGEX,
  ATS_TOKEN_MIXED_REGEX,
  humanizeToken,
} from "@/lib/scraper/utils";
import { boardById } from "@/lib/scraper/boards";
import { ATS_PROVIDERS } from "@/lib/scraper/ats/registry";
import type { ResolveResult } from "@/lib/scraper/ats/types";
import greenhouseSeed from "@/lib/scraper/greenhouse/companies.json";
import leverSeed from "@/lib/scraper/lever/companies.json";
import ashbySeed from "@/lib/scraper/ashby/companies.json";
import ripplingSeed from "@/lib/scraper/rippling/companies.json";
import workableSeed from "@/lib/scraper/workable/companies.json";
import smartrecruitersSeed from "@/lib/scraper/smartrecruiters/companies.json";
import personioSeed from "@/lib/scraper/personio/companies.json";
import recruiteeSeed from "@/lib/scraper/recruitee/companies.json";
import type { JobBoard, LeverHost } from "@/models/automation.model";

// `host` is present (optional) on Lever entries only; every other board's
// entries omit it.
type SeedCompany = { name: string; token: string; host?: LeverHost };

// Greenhouse, Lever and Ashby carry thousands of companies each; the five
// boards phase 5 added carry a handful, and that is not an oversight waiting to
// be filled in. There is no public index of Rippling / Workable /
// SmartRecruiters / Personio / Recruitee boards to harvest, and the old panel
// had none either — it learned a slug from a link it had already collected and
// kept exactly two hand-named extras in data/ats_extra.json. The entries here
// are the boards verified against a live response on 19.09.2026, and the way in
// for anything else is the board's resolve(), which the wizard's "or paste a
// <host> link" field calls.

const SEEDS: Record<string, SeedCompany[]> = {
  greenhouse: greenhouseSeed,
  lever: leverSeed as SeedCompany[],
  ashby: ashbySeed as SeedCompany[],
  rippling: ripplingSeed as SeedCompany[],
  workable: workableSeed as SeedCompany[],
  smartrecruiters: smartrecruitersSeed as SeedCompany[],
  personio: personioSeed as SeedCompany[],
  recruitee: recruiteeSeed as SeedCompany[],
};

// Typeahead over the seeded companies.json (server-side filter, paginated).
// An empty query browses the full list (alphabetical); `offset` drives the
// infinite-scroll load-more. Returns a page plus whether more remain.
export async function searchAtsCompanies(
  provider: JobBoard,
  query: string,
  offset = 0,
): Promise<{ companies: SeedCompany[]; hasMore: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { companies: [], hasMore: false };

  const seed = SEEDS[provider] ?? [];
  const q = query.trim().toLowerCase();
  const matches =
    q.length < 1
      ? seed
      : seed.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.token.toLowerCase().includes(q),
        );

  const companies = matches.slice(
    offset,
    offset + APP_CONSTANTS.ATS_COMPANY_PAGE_SIZE,
  );
  return { companies, hasMore: offset + companies.length < matches.length };
}

// Total number of companies in the seeded directory (for a browse hint).
export async function getAtsCompanyCount(provider: JobBoard): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;
  return (SEEDS[provider] ?? []).length;
}

// Validate a token or board URL; returns the display company name (and, for
// Lever, the resolved host). Dispatches to the board's own resolve().
//
// Each board's token parser belongs in that board's own directory, so this
// action only routes. The fallback is bare-token validation against the board
// table's tokenCase — enough to add a board by slug, without this file growing
// an arm per board.
export async function resolveAtsBoard(
  provider: JobBoard,
  input: string,
): Promise<ResolveResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Not authenticated" };

  const board = boardById(provider);
  if (!board || board.kind !== "companies") {
    return { success: false, message: "Unsupported provider" };
  }

  if (provider === "greenhouse") return resolveGreenhouse(input);
  if (provider === "lever") return resolveLever(input);
  if (provider === "ashby") return resolveAshby(input);

  const registered = ATS_PROVIDERS[provider];
  if (registered?.kind === "companies" && registered.resolve) {
    return registered.resolve(input);
  }

  const token = input.trim();
  const regex =
    board.tokenCase === "mixed" ? ATS_TOKEN_MIXED_REGEX : ATS_TOKEN_REGEX;
  if (!regex.test(token)) {
    return {
      success: false,
      message: `Paste a ${board.label} board token`,
    };
  }
  const seeded = (SEEDS[provider] ?? []).find((c) => c.token === token);
  return { success: true, name: seeded?.name ?? humanizeToken(token), token };
}

// Greenhouse: extract token from a board URL or bare token; validate via
// /boards/{token}; return the API's official name.
function extractGreenhouseToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(
    /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i,
  );
  if (urlMatch) return urlMatch[1].toLowerCase();

  if (!trimmed.includes("/") && !trimmed.includes(".")) {
    const token = trimmed.toLowerCase();
    return ATS_TOKEN_REGEX.test(token) ? token : null;
  }

  return null;
}

async function resolveGreenhouse(input: string): Promise<ResolveResult> {
  const token = extractGreenhouseToken(input);
  if (!token) {
    return {
      success: false,
      message: "Paste a boards.greenhouse.io link or a board token",
    };
  }

  try {
    const response = await fetch(
      `${APP_CONSTANTS.GREENHOUSE_BASE_URL}/${encodeURIComponent(token)}`,
    );

    if (response.status === 404) {
      return {
        success: false,
        message: `No Greenhouse board found for '${token}'`,
      };
    }
    if (!response.ok) {
      return {
        success: false,
        message: `Could not validate board (${response.status})`,
      };
    }

    const data: { name?: string } = await response.json();
    const name = data.name?.trim();
    if (!name) {
      return { success: false, message: "Board has no company name" };
    }

    return { success: true, name, token };
  } catch {
    return { success: false, message: "Could not reach Greenhouse" };
  }
}

// Lever: extract token (+ explicit EU host) from a jobs.lever.co /
// jobs.eu.lever.co URL or bare token; validate by probing the postings
// endpoint; resolve the display name from the seed or a humanized token.
function extractLeverToken(
  input: string,
): { token: string; host?: LeverHost } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/jobs\.(eu\.)?lever\.co\/([a-z0-9_-]+)/i);
  if (urlMatch) {
    return {
      token: urlMatch[2].toLowerCase(),
      host: urlMatch[1] ? "eu" : "default",
    };
  }

  if (!trimmed.includes("/") && !trimmed.includes(".")) {
    return { token: trimmed.toLowerCase() };
  }

  return null;
}

async function probeLeverBoard(
  token: string,
  host: LeverHost,
): Promise<boolean> {
  const base =
    host === "eu"
      ? APP_CONSTANTS.LEVER_EU_BASE_URL
      : APP_CONSTANTS.LEVER_BASE_URL;
  const res = await fetch(
    `${base}/${encodeURIComponent(token)}?mode=json&limit=1`,
  );
  return res.ok;
}

async function resolveLever(input: string): Promise<ResolveResult> {
  const extracted = extractLeverToken(input);
  if (!extracted) {
    return {
      success: false,
      message: "Paste a jobs.lever.co link or a token",
    };
  }

  const { token } = extracted;
  // Defense-in-depth: reject a malformed token before any fetch.
  if (!ATS_TOKEN_REGEX.test(token)) {
    return { success: false, message: `Invalid Lever token '${token}'` };
  }

  try {
    let host: LeverHost;
    if (extracted.host === "eu") {
      if (!(await probeLeverBoard(token, "eu"))) {
        return { success: false, message: `No Lever board found for '${token}'` };
      }
      host = "eu";
    } else {
      // Bare token or default-host URL: probe default first, fall back to EU.
      if (await probeLeverBoard(token, "default")) {
        host = "default";
      } else if (await probeLeverBoard(token, "eu")) {
        host = "eu";
      } else {
        return { success: false, message: `No Lever board found for '${token}'` };
      }
    }

    const seeded = (leverSeed as SeedCompany[]).find((c) => c.token === token);
    const name = seeded?.name ?? humanizeToken(token);
    return { success: true, name, token, host };
  } catch {
    return { success: false, message: "Could not reach Lever" };
  }
}

// Ashby: extract the token from a jobs.ashbyhq.com URL (board or deep posting
// link) or a bare token; validate with a single call — an unknown board 404s,
// so there is nothing to probe. The payload carries no company name, so the
// display name comes from the seed or a humanized token, as with Lever.
function extractAshbyToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();

  if (!trimmed.includes("/") && !trimmed.includes(".")) {
    return trimmed.toLowerCase();
  }

  return null;
}

async function resolveAshby(input: string): Promise<ResolveResult> {
  const token = extractAshbyToken(input);
  if (!token) {
    return {
      success: false,
      message: "Paste a jobs.ashbyhq.com link or a token",
    };
  }

  // Defense-in-depth: reject a malformed token before any fetch.
  if (!ATS_TOKEN_REGEX.test(token)) {
    return { success: false, message: `Invalid Ashby token '${token}'` };
  }

  try {
    const res = await fetch(
      `${APP_CONSTANTS.ASHBY_BASE_URL}/${encodeURIComponent(token)}`,
    );
    res.body?.cancel(); // status is all we need; skip the full board payload

    if (res.status === 404) {
      return { success: false, message: `No Ashby board found for '${token}'` };
    }
    if (!res.ok) {
      return {
        success: false,
        message: `Could not validate board (${res.status})`,
      };
    }

    const seeded = (ashbySeed as SeedCompany[]).find((c) => c.token === token);
    return { success: true, name: seeded?.name ?? humanizeToken(token), token };
  } catch {
    return { success: false, message: "Could not reach Ashby" };
  }
}
