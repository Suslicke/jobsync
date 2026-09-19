import { z } from "zod";
import { APP_CONSTANTS } from "@/lib/constants";
// Deep-imports (NOT the barrel) — utils.ts and boards.ts are pure; the barrel
// pulls scraper network code into the client bundle via this file's client
// consumers.
import { ATS_TOKEN_REGEX, ATS_TOKEN_MIXED_REGEX } from "@/lib/scraper/utils";
import {
  BOARDS,
  BOARD_IDS,
  boardById,
  type BoardKind,
  type BoardKindOf,
  type BoardTokenCase,
  type JobBoard,
} from "@/lib/scraper/boards";

export const JobBoardSchema = z.enum(BOARD_IDS);

export const AutomationStatusSchema = z.enum(["active", "paused"]);

export const AutomationRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "completed_with_errors",
  "blocked",
  "rate_limited",
]);

export const DiscoveryStatusSchema = z.enum(["new", "accepted", "dismissed"]);

// The fields the pipeline consumes, whatever the board fetched.
const BaseSourceConfigSchema = z.object({
  targetTitles: z.array(z.string().min(1).max(100)).optional(),
  keywords: z.array(z.string().min(1).max(100)).optional(),
  locations: z.array(z.string().min(1).max(100)).optional(),
  strictLocation: z.boolean().optional(),
  topK: z.number().int().min(1).max(APP_CONSTANTS.ATS_LISTING_CAP).optional(),
  saveUnanalyzed: z.boolean().optional(),
});

// The token allowlist rejects path/query injection before the token is ever
// interpolated into a fetch URL, so it is applied at the save boundary too —
// a directly-POSTed config never reaches the adapter unchecked.
const companySchema = (tokenCase: BoardTokenCase) =>
  z.object({
    name: z.string().min(1).max(200),
    token: z
      .string()
      .regex(tokenCase === "mixed" ? ATS_TOKEN_MIXED_REGEX : ATS_TOKEN_REGEX),
    host: z.enum(["default", "eu"]).optional(),
  });

const companiesSourceConfigSchema = (tokenCase: BoardTokenCase) =>
  BaseSourceConfigSchema.extend({
    companies: z
      .array(companySchema(tokenCase))
      .max(APP_CONSTANTS.ATS_MAX_COMPANIES),
  });

export const CompaniesSourceConfigSchema = companiesSourceConfigSchema("lower");

export const QuerySourceConfigSchema = BaseSourceConfigSchema.extend({
  queries: z
    .array(z.string().min(1).max(100))
    .max(APP_CONSTANTS.QUERY_MAX_TERMS),
  geos: z.array(z.string().min(1).max(100)).max(APP_CONSTANTS.QUERY_MAX_TERMS),
});

export const FeedSourceConfigSchema = BaseSourceConfigSchema.extend({
  maxPages: z.number().int().min(1).max(APP_CONSTANTS.JOBSPRESSO_MAX_PAGES).optional(),
  visaSponsorshipOnly: z.boolean().optional(),
});

export const ChannelSourceConfigSchema = BaseSourceConfigSchema.extend({
  channels: z
    .array(z.string().min(1).max(100))
    .max(APP_CONSTANTS.TELEGRAM_MAX_CHANNELS),
});

const KIND_SCHEMA = {
  companies: CompaniesSourceConfigSchema,
  query: QuerySourceConfigSchema,
  feed: FeedSourceConfigSchema,
  channel: ChannelSourceConfigSchema,
} as const;

// One key per board, typed to that board's kind. Built by mapping the table
// rather than listed by hand: a board missing from this object is stripped by
// z.object at save time, silently, with no error anywhere to explain why the
// automation runs against nothing.
type SourceConfigShape = {
  [B in JobBoard]: z.ZodOptional<(typeof KIND_SCHEMA)[BoardKindOf<B>]>;
};

export const SourceConfigSchema = z.object(
  Object.fromEntries(
    BOARDS.map((b) => [
      b.id,
      // The per-board instance differs from KIND_SCHEMA's only in which token
      // regex it carries, which does not change the inferred type.
      (b.kind === "companies"
        ? companiesSourceConfigSchema(b.tokenCase)
        : KIND_SCHEMA[b.kind]
      ).optional(),
    ]),
  ) as SourceConfigShape,
);

// One refusal, not three. The runner's no_targets finalization and
// parseBoardConfig answer the same question for their own layers; this is the
// one the user sees, and it has to know which kind is being asked about —
// "Select at least one company" on a feed board is advice nobody can follow.
function refineTargets(
  data: { jobBoard?: JobBoard; sourceConfig?: z.infer<typeof SourceConfigSchema> },
  ctx: z.RefinementCtx,
): void {
  if (!data.jobBoard) return;
  const kind: BoardKind | undefined = boardById(data.jobBoard)?.kind;
  if (!kind) return;
  const cfg = data.sourceConfig?.[data.jobBoard] as
    | Record<string, unknown>
    | undefined;
  const count = (key: string) => {
    const value = cfg?.[key];
    return Array.isArray(value) ? value.length : 0;
  };
  const fail = (path: string, message: string) =>
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceConfig", data.jobBoard as string, path],
      message,
    });

  if (kind === "companies" && count("companies") < 1) {
    fail("companies", "Select at least one company");
  }
  if (kind === "query") {
    if (count("queries") < 1) fail("queries", "Add at least one search term");
    if (count("geos") < 1) fail("geos", "Add at least one location to search");
    // The per-list caps are not the bound: a query board walks one search per
    // PAIR, so ten terms and ten locations is a hundred walks and three
    // quarters of an hour of paced fetching — which the wizard used to accept
    // without a word.
    const pairs = count("queries") * count("geos");
    if (pairs > APP_CONSTANTS.QUERY_MAX_PAIRS) {
      fail(
        "geos",
        `That is ${pairs} searches (each term is searched in each location). Keep it to ${APP_CONSTANTS.QUERY_MAX_PAIRS}.`,
      );
    }
  }
  if (kind === "channel" && count("channels") < 1) {
    fail("channels", "Add at least one channel");
  }
  // A feed needs nothing configured: the whole feed is the target.
}

export const CreateAutomationSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    jobBoard: JobBoardSchema,
    keywords: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    sourceConfig: SourceConfigSchema.optional(),
    resumeId: z.string().uuid("Invalid resume"),
    matchThreshold: z.number().min(0).max(100),
    scheduleHour: z.number().min(0).max(23),
  })
  .superRefine(refineTargets);

export const UpdateAutomationSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    jobBoard: JobBoardSchema.optional(),
    keywords: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    sourceConfig: SourceConfigSchema.optional(),
    resumeId: z.string().uuid("Invalid resume").optional(),
    matchThreshold: z.number().min(0).max(100).optional(),
    scheduleHour: z.number().min(0).max(23).optional(),
  })
  .superRefine(refineTargets);

export type CreateAutomationInput = z.infer<typeof CreateAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationSchema>;
export type SourceConfigInput = z.infer<typeof SourceConfigSchema>;
