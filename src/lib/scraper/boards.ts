import { APP_CONSTANTS } from "@/lib/constants";

// The one place a job board is declared.
//
// A board used to be a name spelled out in eleven independent enumerations —
// ATS_BOARDS, ATS_PROVIDERS, SourceConfigSchema, JobBoardSchema, PROVIDER_META,
// the CompanyScope union, companyBoardUrl's if-chain, StepBasics' <SelectItem>
// rows, wizardConfig's AtsKey, parseEditSourceConfig and the MCP tool's prose —
// and each one fails differently and silently when it is the one left out: a
// missing ATS_BOARDS entry means the scheduler never fires the automation at
// all; a missing ATS_PROVIDERS entry finalizes every run as blocked /
// source_removed; a missing SourceConfigSchema key makes z.object strip the
// whole config at the save boundary with no error anywhere. Three boards could
// survive that by hand. Sixteen cannot.
//
// Client-safe on purpose: pure data plus URL builders, no fetch and no p-limit,
// so the wizard and the Library can import it. The search functions live in the
// server-only ats/registry.ts, which is the one enumeration this table cannot
// absorb.

export type BoardKind = "companies" | "query" | "feed" | "channel";

// The noun a run log counts in. A feed run that printed "Fetching 1 companies"
// would be describing work it is not doing.
export type BoardUnit = "company" | "query" | "channel" | "feed";

// SmartRecruiters slugs are capitalised ('Mirantis', 'Acumatica') and the
// lowercase-only ATS_TOKEN_REGEX rejects them at the save boundary, so the
// allowlist is chosen per board rather than shared.
export type BoardTokenCase = "lower" | "mixed";

export interface BoardWizardMeta {
  // Shown under the board picker in StepBasics.
  description: string;
  // Company boards only: the "paste a board link" hint and the typeahead's
  // example. Absent on the other kinds, which have no company picker — an
  // empty hint rendered there would be a field that does nothing.
  urlHint?: string;
  searchExample?: string;
}

export interface BoardRow {
  // The sourceConfig JSON key and the Automation.jobBoard column value.
  id: string;
  // Display name AND the JobSource label written on every saved Job.
  label: string;
  kind: BoardKind;
  unit: BoardUnit;
  tokenCase: BoardTokenCase;
  // The public board page for one company. Company boards only.
  boardUrl?: (company: { token: string; host?: "default" | "eu" }) => string;
  // Arbeitnow's ?visa_sponsorship=true is the only server-side sponsorship
  // filter that works anywhere in this pool. Rendering the toggle on Remotive
  // too would be a control that silently changes nothing.
  visaFilter?: true;
  wizard: BoardWizardMeta;
}

// Declared `as const` so JobBoard and BoardKindOf can be read off it; exported
// through BOARDS below as the widened row type, or every consumer that iterates
// the table would see a sixteen-member union where only some members have a
// boardUrl.
const BOARD_TABLE = [
  {
    id: "greenhouse",
    label: "Greenhouse",
    kind: "companies",
    unit: "company",
    tokenCase: "lower",
    boardUrl: (c) => `${APP_CONSTANTS.GREENHOUSE_BOARD_URL}/${c.token}`,
    wizard: {
      description: "Track specific companies' Greenhouse boards",
      urlHint: "Or paste a boards.greenhouse.io link",
      searchExample: "Anthropic",
    },
  },
  {
    id: "lever",
    label: "Lever",
    kind: "companies",
    unit: "company",
    tokenCase: "lower",
    // Lever's public posting host is region-specific and differs from its API
    // host, so it comes from the company's persisted `host`.
    boardUrl: (c) =>
      `${c.host === "eu" ? APP_CONSTANTS.LEVER_EU_JOB_URL : APP_CONSTANTS.LEVER_JOB_URL}/${c.token}`,
    wizard: {
      description: "Track specific companies' Lever boards",
      urlHint: "Or paste a jobs.lever.co link or token",
      searchExample: "Netflix",
    },
  },
  {
    id: "ashby",
    label: "Ashby",
    kind: "companies",
    unit: "company",
    tokenCase: "lower",
    boardUrl: (c) => `${APP_CONSTANTS.ASHBY_JOB_URL}/${c.token}`,
    wizard: {
      description: "Track specific companies' Ashby boards",
      urlHint: "Or paste a jobs.ashbyhq.com link or token",
      searchExample: "Ramp",
    },
  },
  {
    id: "rippling",
    label: "Rippling",
    kind: "companies",
    unit: "company",
    tokenCase: "lower",
    boardUrl: (c) => `${APP_CONSTANTS.RIPPLING_BOARD_URL}/${c.token}/jobs`,
    wizard: {
      description: "Track specific companies' Rippling boards",
      urlHint: "Or paste an ats.rippling.com link or token",
      searchExample: "Chess.com",
    },
  },
  {
    id: "workable",
    label: "Workable",
    kind: "companies",
    unit: "company",
    tokenCase: "lower",
    boardUrl: (c) => `${APP_CONSTANTS.WORKABLE_BOARD_URL}/${c.token}`,
    wizard: {
      description: "Track specific companies' Workable boards",
      urlHint: "Or paste an apply.workable.com link or token",
      searchExample: "Action1",
    },
  },
  {
    id: "smartrecruiters",
    label: "SmartRecruiters",
    kind: "companies",
    unit: "company",
    tokenCase: "mixed",
    boardUrl: (c) => `${APP_CONSTANTS.SMARTRECRUITERS_BOARD_URL}/${c.token}`,
    wizard: {
      description: "Track specific companies' SmartRecruiters boards",
      urlHint: "Or paste a jobs.smartrecruiters.com link or token",
      searchExample: "Mirantis",
    },
  },
  {
    id: "personio",
    label: "Personio",
    kind: "companies",
    unit: "company",
    tokenCase: "lower",
    boardUrl: (c) => `https://${c.token}${APP_CONSTANTS.PERSONIO_BOARD_SUFFIX}`,
    wizard: {
      description: "Track specific companies' Personio boards",
      urlHint: "Or paste a jobs.personio.de link or token",
      searchExample: "Vivid",
    },
  },
  {
    id: "recruitee",
    label: "Recruitee",
    kind: "companies",
    unit: "company",
    tokenCase: "lower",
    boardUrl: (c) => `https://${c.token}${APP_CONSTANTS.RECRUITEE_BOARD_SUFFIX}`,
    wizard: {
      description: "Track specific companies' Recruitee boards",
      urlHint: "Or paste a recruitee.com link or token",
      searchExample: "Wallarm",
    },
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    kind: "query",
    unit: "query",
    tokenCase: "lower",
    wizard: {
      description:
        "Search LinkedIn's guest job endpoint by keyword and location",
    },
  },
  {
    id: "himalayas",
    label: "Himalayas",
    kind: "feed",
    unit: "feed",
    tokenCase: "lower",
    wizard: {
      description: "Collect the newest remote roles from the Himalayas feed",
    },
  },
  {
    id: "arbeitnow",
    label: "Arbeitnow",
    kind: "feed",
    unit: "feed",
    tokenCase: "lower",
    visaFilter: true,
    wizard: {
      description:
        "Collect the Arbeitnow feed, optionally only visa-sponsoring roles",
    },
  },
  {
    id: "remotive",
    label: "Remotive",
    kind: "feed",
    unit: "feed",
    tokenCase: "lower",
    wizard: {
      description: "Collect the Remotive remote-jobs feed",
    },
  },
  {
    id: "workingnomads",
    label: "Working Nomads",
    kind: "feed",
    unit: "feed",
    tokenCase: "lower",
    wizard: {
      description: "Collect the Working Nomads remote-jobs feed",
    },
  },
  {
    id: "jobspresso",
    label: "Jobspresso",
    kind: "feed",
    unit: "feed",
    tokenCase: "lower",
    wizard: {
      description: "Collect the Jobspresso listings feed",
    },
  },
  {
    id: "remotecom",
    label: "Remote.com",
    kind: "feed",
    unit: "feed",
    tokenCase: "lower",
    wizard: {
      description: "Collect the Remote.com public talent feed",
    },
  },
  {
    id: "telegram",
    label: "Telegram",
    kind: "channel",
    unit: "channel",
    tokenCase: "lower",
    wizard: {
      description: "Read job posts from public Telegram channels",
    },
  },
] as const satisfies readonly BoardRow[];

export type JobBoard = (typeof BOARD_TABLE)[number]["id"];

// The kind a given board id declares, so a schema or config type can be keyed
// to the right shape without a second table saying the same thing.
export type BoardKindOf<B extends JobBoard> = Extract<
  (typeof BOARD_TABLE)[number],
  { id: B }
>["kind"];

// z.enum and Prisma's `in` both want a plain tuple of ids.
export const BOARD_IDS = BOARD_TABLE.map((b) => b.id) as unknown as [
  JobBoard,
  ...JobBoard[],
];

// The declared row type, narrowed to the ids the table actually holds, so a
// caller reading `board.id` gets a JobBoard and not a bare string.
export type Board = Omit<BoardRow, "id"> & { id: JobBoard };

export const BOARDS: readonly Board[] = BOARD_TABLE;

const BY_ID = new Map<string, Board>(BOARDS.map((b) => [b.id, b]));

export function boardById(id: string): Board | undefined {
  return BY_ID.get(id);
}

// Falls back to the raw id rather than throwing: a retired board still has
// rows in the database, and a detail page that crashes is worse than one that
// shows a slug.
export function boardLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

export function boardsOfKind(kind: BoardKind): Board[] {
  return BOARDS.filter((b) => b.kind === kind);
}
