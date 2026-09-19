import { APP_CONSTANTS } from "@/lib/constants";
import { boardById } from "../boards";
import type { AtsCompany, JobBoard } from "@/models/automation.model";

// What the pipeline consumes, identical for every kind.
interface BaseRunConfig {
  targetTitles: string[];
  keywords: string[];
  locations: string[];
  strictLocation: boolean;
  topK: number;
  saveUnanalyzed: boolean;
}

export type BoardRunConfig = BaseRunConfig &
  (
    | { kind: "companies"; companies: AtsCompany[] }
    | { kind: "query"; queries: string[]; geos: string[] }
    | { kind: "feed"; maxPages: number; visaSponsorshipOnly: boolean }
    | { kind: "channel"; channels: string[] }
  );

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export function parseBoardConfig(
  sourceConfig: string | null | undefined,
  jobBoard: JobBoard,
): BoardRunConfig | null {
  const board = boardById(jobBoard);
  if (!board || !sourceConfig) return null;
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(sourceConfig)?.[jobBoard];
  } catch {
    return null;
  }
  // A feed board legitimately carries no targets at all, so the gate is on the
  // config object existing, not on a `companies` array being present — that
  // array check used to be one of three independent refusals of the same
  // missing field, and on a feed it refused a perfectly valid automation.
  if (!cfg || typeof cfg !== "object") return null;

  const base: BaseRunConfig = {
    targetTitles: strings(cfg.targetTitles),
    keywords: strings(cfg.keywords),
    locations: strings(cfg.locations),
    strictLocation: !!cfg.strictLocation,
    topK:
      typeof cfg.topK === "number" && cfg.topK > 0
        ? cfg.topK
        : APP_CONSTANTS.MAX_JOBS_PER_RUN,
    saveUnanalyzed: cfg.saveUnanalyzed !== false,
  };

  switch (board.kind) {
    case "companies":
      if (!Array.isArray(cfg.companies)) return null;
      return { ...base, kind: "companies", companies: cfg.companies as AtsCompany[] };
    case "query":
      return {
        ...base,
        kind: "query",
        queries: strings(cfg.queries),
        geos: strings(cfg.geos),
      };
    case "feed":
      return {
        ...base,
        kind: "feed",
        maxPages:
          typeof cfg.maxPages === "number" && cfg.maxPages > 0
            ? cfg.maxPages
            : APP_CONSTANTS.HIMALAYAS_MAX_PAGES,
        visaSponsorshipOnly: !!cfg.visaSponsorshipOnly,
      };
    case "channel":
      return { ...base, kind: "channel", channels: strings(cfg.channels) };
  }
}

// How many units of work this config asks for. Zero means the run has nothing
// to fetch — except on a feed, where the feed itself is the single target.
export function targetCount(config: BoardRunConfig): number {
  switch (config.kind) {
    case "companies":
      return config.companies.length;
    case "query":
      return config.queries.length * config.geos.length;
    case "feed":
      return 1;
    case "channel":
      return config.channels.length;
  }
}
