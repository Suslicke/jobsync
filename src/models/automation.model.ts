// Automation types and interfaces

import { BOARD_IDS, type JobBoard } from "@/lib/scraper/boards";

export type AutomationStatus = "active" | "paused";
export type AutomationRunStatus =
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "completed_with_errors"
  | "blocked"
  | "rate_limited"
  | "cancelled";
export type DiscoveryStatus = "new" | "accepted" | "dismissed";
// Order the discovered pile is read in. The server applies it across every
// page, so the choice belongs to the query, not to the loaded slice.
export type DiscoveredSortBy = "matchScore" | "reach" | "discoveredAt";
// Every board is declared once, in the scraper's board table; JobBoard and the
// scheduler's board list are derived from it rather than retyped here.
export type { JobBoard };

export type LeverHost = "default" | "eu";

// A company entry on a companies-kind board. `host` is optional and Lever-only
// (every other board ignores it); it's persisted once a company is resolved so
// runtime fetches never re-probe regions.
export interface AtsCompany {
  name: string;
  token: string;
  host?: LeverHost;
}

// What the pipeline consumes, whatever the board fetched. Shared by all four
// kinds so ranking, the location gate and the LLM budget stay one code path.
export interface BaseSourceConfig {
  targetTitles?: string[];
  keywords?: string[];
  locations?: string[];
  strictLocation?: boolean;
  topK?: number;
  saveUnanalyzed?: boolean;
}

export interface CompaniesSourceConfig extends BaseSourceConfig {
  companies: AtsCompany[];
}

// `locations` is deliberately NOT reused as the query geography. It and
// strictLocation are a post-fetch gate (pipeline.ts -> rank.ts locationMatches)
// and are never sent anywhere; `geos` is a request parameter. Same name,
// opposite direction of travel — reusing it would quietly turn "Only show jobs
// in these locations" into "and also fetch only those".
export interface QuerySourceConfig extends BaseSourceConfig {
  queries: string[];
  geos: string[];
}

export interface FeedSourceConfig extends BaseSourceConfig {
  maxPages?: number;
  // Only meaningful where the board table says visaFilter; the wizard renders
  // the toggle nowhere else.
  visaSponsorshipOnly?: boolean;
}

export interface ChannelSourceConfig extends BaseSourceConfig {
  channels: string[];
}

export type AnySourceConfig =
  | CompaniesSourceConfig
  | QuerySourceConfig
  | FeedSourceConfig
  | ChannelSourceConfig;

export type SourceConfig = Partial<Record<JobBoard, AnySourceConfig>>;

// Kept as an alias: the ten company-picker call sites all name it, and
// renaming them would be churn with no behaviour behind it.
export type LeverCompany = AtsCompany;

// Plain, dependency-free board list. Do NOT import ats/registry.ts for this
// (that pulls the network-calling search fns into client bundles).
export const ATS_BOARDS: JobBoard[] = [...BOARD_IDS];

// Boards that used to exist and were removed. Their Automation rows stay in
// the database; the UI marks them retired and only offers pause/delete.
export const RETIRED_BOARDS = ["jsearch"];
export function isRetiredBoard(board: string): boolean {
  return RETIRED_BOARDS.includes(board);
}

export interface Automation {
  id: string;
  userId: string;
  name: string;
  jobBoard: JobBoard;
  keywords: string;
  location: string;
  sourceConfig?: string | null;
  resumeId: string;
  matchThreshold: number;
  scheduleHour: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  status: AutomationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationWithResume extends Automation {
  resume: {
    id: string;
    title: string;
  };
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  jobsSearched: number;
  jobsDeduplicated: number;
  jobsProcessed: number;
  jobsMatched: number;
  jobsSaved: number;
  status: AutomationRunStatus;
  errorMessage: string | null;
  blockedReason: string | null;
  funnelStats: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface DiscoveredJob {
  id: string;
  userId: string;
  automationId: string;
  automation?: {
    id: string;
    name: string;
  };
  jobUrl: string | null;
  description: string;
  jobType: string;
  workplaceType?: string | null;
  createdAt: Date;
  jobTitleId: string;
  companyId: string;
  locationId: string | null;
  matchScore: number;
  matchData: string | null;
  // Reachability, already computed at insert time by the automation's persist
  // step; the query uses `include`, so both fields come back with the row.
  reachScore?: number | null;
  reachData?: string | null;
  discoveryStatus: DiscoveryStatus;
  discoveredAt: Date;
  JobTitle: { label: string };
  Company: { label: string };
  Location?: { label: string } | null;
}

export interface ScrapedJobData {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  sourceBoard: JobBoard;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
}
