import { z } from "zod";
import db from "@/lib/db";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";
import { calculateNextRunAt } from "@/lib/scraper/schedule";
import { CreateAutomationSchema, JobBoardSchema, SourceConfigSchema } from "@/models/automation.schema";
import { assertScheduleCapacity } from "@/actions/automation/shared";
import { BOARDS, boardById } from "@/lib/scraper/boards";
import { syncSchedulerState } from "@/lib/scheduler";
import { getDefaultResumeForUser } from "@/lib/jobs/getDefaultResumeForUser";

// Built from the board table, not prose: "greenhouse, lever or ashby" was
// already wrong the moment a fourth board existed, and an agent reading a
// stale list configures a board that cannot run.
const BOARD_LIST = BOARDS.map((b) => `${b.id} (${b.kind})`).join(", ");
const CONFIG_HINT =
  "Keyed by jobBoard. companies boards take { companies: [{ name, token }] } where token is the board slug from the board URL; " +
  "query boards take { queries: [...], geos: [...] }; feed boards take { maxPages } (plus visaSponsorshipOnly on arbeitnow); " +
  "channel boards take { channels: [...] }. Every kind also accepts targetTitles, keywords, locations, strictLocation, topK, saveUnanalyzed.";

// The unit a board counts in, for the success line — "0 companies" on a feed
// would report a failure that did not happen.
function describeConfigured(
  board: ReturnType<typeof boardById>,
  cfg: Record<string, unknown> | undefined,
): string {
  if (!board) return "configured";
  const count = (key: string) => (Array.isArray(cfg?.[key]) ? (cfg[key] as unknown[]).length : 0);
  switch (board.kind) {
    case "companies":
      return `${count("companies")} companies`;
    case "query":
      return `${count("queries")} queries x ${count("geos")} locations`;
    case "channel":
      return `${count("channels")} channels`;
    case "feed":
      return "the whole feed";
  }
}

// Local addition: mirrors actions/automation/mutations.ts#createAutomation (session-bound) for MCP callers.
// Kept out of a "use server" file on purpose — an exported action taking userId would be callable by any client.
export const McpAddAutomationInputShape = {
  name: z.string().min(1).max(100),
  jobBoard: JobBoardSchema.describe(`One board per automation: ${BOARD_LIST}.`),
  sourceConfig: SourceConfigSchema.describe(CONFIG_HINT),
  keywords: z.string().max(200).optional(),
  location: z.string().max(100).optional(),
  resumeId: z.string().uuid().optional().describe("Resume to match against. Defaults to the user's default resume."),
  matchThreshold: z.number().min(0).max(100).optional().describe("Defaults to 70."),
  scheduleHour: z.number().int().min(0).max(23).describe("Server-time hour."),
};
export const McpAddAutomationSchema = z.object(McpAddAutomationInputShape);

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function handleAddAutomation(input: z.infer<typeof McpAddAutomationSchema>, userId: string) {
  const rateCheck = checkMcpRateLimit(userId);
  if (!rateCheck.allowed) return text(`Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.`);

  try {
    const resumeId = input.resumeId ?? (await getDefaultResumeForUser(userId))?.id;
    if (!resumeId) return text("Error: no resumeId given and no default resume set — set one in Profile → Resumes.");

    const parsed = CreateAutomationSchema.safeParse({ ...input, resumeId, matchThreshold: input.matchThreshold ?? 70 });
    if (!parsed.success) return text(`Validation error: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const v = parsed.data;

    const capacity = await assertScheduleCapacity(userId, v.scheduleHour);
    if (!capacity.ok) return text(`Error: ${capacity.message}`);
    if (!(await db.resume.findFirst({ where: { id: v.resumeId, profile: { userId } } }))) {
      return text("Error: resume not found or doesn't belong to you.");
    }

    const automation = await db.automation.create({
      data: {
        userId,
        name: v.name,
        jobBoard: v.jobBoard,
        keywords: v.keywords ?? "",
        location: v.location ?? "",
        sourceConfig: v.sourceConfig ? JSON.stringify(v.sourceConfig) : null,
        resumeId: v.resumeId,
        matchThreshold: v.matchThreshold,
        scheduleHour: v.scheduleHour,
        nextRunAt: calculateNextRunAt(v.scheduleHour),
        status: "active",
      },
    });
    await syncSchedulerState();
    const configured = describeConfigured(
      boardById(v.jobBoard),
      v.sourceConfig?.[v.jobBoard] as Record<string, unknown> | undefined,
    );
    return text(`Automation created (id: ${automation.id}): ${v.name}, ${v.jobBoard}, ${configured}, daily at ${v.scheduleHour}:00.`);
  } catch (err: any) {
    return text(`Error: ${err?.message ?? "Unknown error"}`);
  }
}
