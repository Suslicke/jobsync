import type { JobBoard } from "@/models/automation.model";
import type { AtsCompany, LeverHost } from "@/models/automation.model";
import type { JobDetails } from "../types";

// `host` is optional and Lever-only (every other board ignores it); it's
// persisted once a company is resolved so runtime fetches never re-probe
// regions.
export type AtsHost = LeverHost;

export interface SearchOutcome {
  jobs: JobDetails[];
  // One entry per unit of work that failed — a board slug, a query string, a
  // channel, a feed page. `token` keeps its name because every consumer logs
  // it as "the thing that failed".
  errors: { token: string; reason: string }[];
  // Fetched vs available, so "collected 200" cannot be read as "collected
  // everything": Himalayas is ~102k postings deep and hard-caps a page at 20
  // rows whatever `limit` says. `available: null` where the source does not
  // say — unknown depth is null, never 0.
  coverage?: { fetched: number; available: number | null };
}

export type ResolveResult =
  | { success: true; name: string; token: string; host?: AtsHost }
  | { success: false; message: string };

interface BoardProviderBase {
  id: JobBoard;
  label: string;
  // Fills in what the list endpoint does not carry. Called AFTER ranking, on
  // the survivors only: Rippling, Workable, SmartRecruiters, remote.com and
  // LinkedIn all publish the description on the posting page, and a board with
  // 2000 cards must cost N detail requests, not 2000.
  hydrate?(jobs: JobDetails[], signal?: AbortSignal): Promise<JobDetails[]>;
}

// The kind decides one thing only: which argument search() receives. The
// return type is identical across all four, which is what lets runAtsRun, the
// pipeline, dedup and persist stay a single code path.
//
// Every search() takes the run's signal as its second argument. It used to take
// none, which was tolerable while a board was a company watchlist bounded by a
// 25-second per-board deadline; phase 5 moved the long work inside search() —
// a LinkedIn sweep walks pairs for minutes on end — and an uninterruptible
// search() makes the whole cancel machinery (the /cancel route, runner.ts's
// 500 ms poll, a dropped parent request) decorative until it returns.
export interface CompaniesProvider extends BoardProviderBase {
  kind: "companies";
  // Fetch a watchlist with bounded concurrency + per-token isolation.
  search(
    companies: AtsCompany[],
    signal?: AbortSignal,
  ): Promise<SearchOutcome>;
  // Token/URL parsing plus a live probe, for the picker. Lives on the provider
  // so each board's parser stays inside its own directory and the shared
  // action only dispatches. Boards that omit it fall back to bare-token
  // validation against the board table's tokenCase.
  resolve?(input: string): Promise<ResolveResult>;
}

export interface QueryProvider extends BoardProviderBase {
  kind: "query";
  search(
    config: { queries: string[]; geos: string[] },
    signal?: AbortSignal,
  ): Promise<SearchOutcome>;
}

export interface FeedProvider extends BoardProviderBase {
  kind: "feed";
  search(
    config: {
      maxPages: number;
      visaSponsorshipOnly?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<SearchOutcome>;
}

export interface ChannelProvider extends BoardProviderBase {
  kind: "channel";
  search(
    config: { channels: string[] },
    signal?: AbortSignal,
  ): Promise<SearchOutcome>;
}

export type BoardProvider =
  | CompaniesProvider
  | QueryProvider
  | FeedProvider
  | ChannelProvider;

// The name the runner and the barrel have always used.
export type AtsProvider = BoardProvider;
