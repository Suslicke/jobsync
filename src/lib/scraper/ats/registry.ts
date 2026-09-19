import type { JobBoard } from "@/models/automation.model";
import { boardLabel } from "../boards";
import { searchGreenhouseJobs } from "../greenhouse";
import { searchLeverJobs } from "../lever";
import { searchAshbyJobs } from "../ashby";
import {
  hydrateRipplingJobs,
  resolveRipplingBoard,
  searchRipplingJobs,
} from "../rippling";
import {
  hydrateWorkableJobs,
  resolveWorkableBoard,
  searchWorkableJobs,
} from "../workable";
import {
  hydrateSmartRecruitersJobs,
  resolveSmartRecruitersBoard,
  searchSmartRecruitersJobs,
} from "../smartrecruiters";
import { resolvePersonioBoard, searchPersonioJobs } from "../personio";
import { resolveRecruiteeBoard, searchRecruiteeJobs } from "../recruitee";
import { hydrateLinkedInJobs, searchLinkedInJobs } from "../linkedin";
import { searchHimalayasJobs } from "../himalayas";
import { searchArbeitnowJobs } from "../arbeitnow";
import { searchRemotiveJobs } from "../remotive";
import { searchWorkingNomadsJobs } from "../workingnomads";
import {
  hydrateJobspressoJobs,
  searchJobspressoJobs,
} from "../jobspresso";
import { hydrateRemotecomJobs, searchRemotecomJobs } from "../remotecom";
import { searchTelegramChannels } from "../telegram";
import type { BoardProvider } from "./types";

// Server-only: imports the real network-calling search fns (fetch, p-limit).
// Never import this from client-bundled code — use ATS_BOARDS (or the board
// table in lib/scraper/boards.ts) for the plain, dependency-free board list.
//
// This is the one enumeration boards.ts cannot absorb, for exactly that
// reason. A board present in the table but missing here finalizes every run as
// blocked / source_removed, so the two lists are kept the same length.
//
// `hydrate` and `resolve` are not optional decoration: an adapter's hydrate is
// reachable ONLY through its entry here, and nothing else in the tree refers to
// it. Five adapters shipped with a hydrate nobody had wired, and the suite
// stayed green — a LinkedIn run then saved every posting with description "",
// scored it against a title alone and stored an unmeasured fit. The parity
// spec in __tests__/wizardConfig.spec.ts now fails a board whose module exports
// a hydrate* that this table does not carry; a board that genuinely needs none
// says so where its entry would have been.
export const ATS_PROVIDERS: Partial<Record<JobBoard, BoardProvider>> = {
  greenhouse: {
    id: "greenhouse",
    label: boardLabel("greenhouse"),
    kind: "companies",
    search: searchGreenhouseJobs,
  },
  lever: {
    id: "lever",
    label: boardLabel("lever"),
    kind: "companies",
    search: searchLeverJobs,
  },
  ashby: {
    id: "ashby",
    label: boardLabel("ashby"),
    kind: "companies",
    search: searchAshbyJobs,
  },
  rippling: {
    id: "rippling",
    label: boardLabel("rippling"),
    kind: "companies",
    search: searchRipplingJobs,
    hydrate: hydrateRipplingJobs,
    resolve: resolveRipplingBoard,
  },
  workable: {
    id: "workable",
    label: boardLabel("workable"),
    kind: "companies",
    search: searchWorkableJobs,
    hydrate: hydrateWorkableJobs,
    resolve: resolveWorkableBoard,
  },
  smartrecruiters: {
    id: "smartrecruiters",
    label: boardLabel("smartrecruiters"),
    kind: "companies",
    search: searchSmartRecruitersJobs,
    hydrate: hydrateSmartRecruitersJobs,
    resolve: resolveSmartRecruitersBoard,
  },
  personio: {
    id: "personio",
    label: boardLabel("personio"),
    kind: "companies",
    search: searchPersonioJobs,
    // No hydrate: the XML document carries every description in full, so there
    // is nothing a detail request would add.
    resolve: resolvePersonioBoard,
  },
  recruitee: {
    id: "recruitee",
    label: boardLabel("recruitee"),
    kind: "companies",
    search: searchRecruiteeJobs,
    // No hydrate: /api/offers/ answers with description AND requirements on
    // every offer, so there is nothing a detail request would add.
    resolve: resolveRecruiteeBoard,
  },
  linkedin: {
    id: "linkedin",
    label: boardLabel("linkedin"),
    kind: "query",
    search: searchLinkedInJobs,
    hydrate: hydrateLinkedInJobs,
  },
  himalayas: {
    id: "himalayas",
    label: boardLabel("himalayas"),
    kind: "feed",
    search: searchHimalayasJobs,
  },
  arbeitnow: {
    id: "arbeitnow",
    label: boardLabel("arbeitnow"),
    kind: "feed",
    search: searchArbeitnowJobs,
  },
  remotive: {
    id: "remotive",
    label: boardLabel("remotive"),
    kind: "feed",
    search: searchRemotiveJobs,
  },
  workingnomads: {
    id: "workingnomads",
    label: boardLabel("workingnomads"),
    kind: "feed",
    search: searchWorkingNomadsJobs,
  },
  jobspresso: {
    id: "jobspresso",
    label: boardLabel("jobspresso"),
    kind: "feed",
    search: searchJobspressoJobs,
    hydrate: hydrateJobspressoJobs,
  },
  remotecom: {
    id: "remotecom",
    label: boardLabel("remotecom"),
    kind: "feed",
    search: searchRemotecomJobs,
    hydrate: hydrateRemotecomJobs,
  },
  telegram: {
    id: "telegram",
    label: boardLabel("telegram"),
    kind: "channel",
    search: searchTelegramChannels,
  },
};
