import { APP_CONSTANTS } from "@/lib/constants";
import { BOARD_IDS, type BoardKind } from "@/lib/scraper/boards";
import type { CreateAutomationInput } from "@/models/automation.schema";
import type {
  AnySourceConfig,
  BaseSourceConfig,
} from "@/models/automation.model";

// Shared by every kind: the pipeline consumes these whatever the board fetched.
const EMPTY_BASE: BaseSourceConfig = {
  targetTitles: [],
  keywords: [],
  locations: [],
  strictLocation: false,
  topK: APP_CONSTANTS.MAX_JOBS_PER_RUN,
  saveUnanalyzed: true,
};

export const EMPTY_COMPANIES = { ...EMPTY_BASE, companies: [] };
export const EMPTY_QUERY = { ...EMPTY_BASE, queries: [], geos: [] };
export const EMPTY_FEED = {
  ...EMPTY_BASE,
  maxPages: APP_CONSTANTS.HIMALAYAS_MAX_PAGES,
  visaSponsorshipOnly: false,
};
export const EMPTY_CHANNEL = { ...EMPTY_BASE, channels: [] };

export function emptyConfigFor(kind: BoardKind): AnySourceConfig {
  switch (kind) {
    case "companies":
      return EMPTY_COMPANIES;
    case "query":
      return EMPTY_QUERY;
    case "feed":
      return EMPTY_FEED;
    case "channel":
      return EMPTY_CHANNEL;
  }
}

export const STEPS = [
  { id: "basics", title: "Basics", description: "Name your automation" },
  { id: "search", title: "Search", description: "Configure search criteria" },
  { id: "resume", title: "Resume", description: "Select resume for matching" },
  { id: "matching", title: "Matching", description: "Set match threshold" },
  { id: "schedule", title: "Schedule", description: "When to run" },
  { id: "review", title: "Review", description: "Confirm settings" },
];

export const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, "0")}:00`,
}));

// Keyed off the board table, not a hand-written or-chain: a board missing from
// that chain silently dropped its own saved config the moment the automation
// was opened for editing.
export function parseEditSourceConfig(
  sc?: string | null,
): CreateAutomationInput["sourceConfig"] | undefined {
  if (!sc) return undefined;
  try {
    const parsed = JSON.parse(sc);
    if (!parsed || typeof parsed !== "object") return undefined;
    return BOARD_IDS.some((id) => parsed[id]) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export interface WizardResume {
  id: string;
  title: string;
}
