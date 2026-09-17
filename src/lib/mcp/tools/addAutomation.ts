import { z } from "zod";
import db from "@/lib/db";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";
import { calculateNextRunAt } from "@/lib/scraper/schedule";
import { CreateAutomationSchema, JobBoardSchema, SourceConfigSchema } from "@/models/automation.schema";
import { APP_CONSTANTS } from "@/lib/constants";
import { syncSchedulerState } from "@/lib/scheduler";
import { getDefaultResumeForUser } from "@/lib/jobs/getDefaultResumeForUser";

// Local addition: mirrors actions/automation/mutations.ts#createAutomation (session-bound) for MCP callers.
// Kept out of a "use server" file on purpose — an exported action taking userId would be callable by any client.
export const McpAddAutomationInputShape = {
  name: z.string().min(1).max(100),
  jobBoard: JobBoardSchema.describe("greenhouse, lever or ashby — one board per automation."),
  sourceConfig: SourceConfigSchema.describe(
    "Keyed by jobBoard, e.g. { lever: { companies: [{ name, token }], targetTitles, keywords, locations, strictLocation, topK, saveUnanalyzed } }. token is the board slug from the board URL.",
  ),
  keywords: z.string().max(200).optional(),
  location: z.string().max(100).optional(),
  resumeId: z.string().uuid().optional().describe("Resume to match against. Defaults to the user's default resume."),
  matchThreshold: z.number().min(0).max(100).optional().describe("Defaults to 70."),
  scheduleHour: z.number().int().min(0).max(23).describe("Server-time hour; one automation per hour."),
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

    if ((await db.automation.count({ where: { userId } })) >= APP_CONSTANTS.MAX_AUTOMATIONS_PER_USER) {
      return text(`Error: maximum of ${APP_CONSTANTS.MAX_AUTOMATIONS_PER_USER} automations per user.`);
    }
    if (await db.automation.findFirst({ where: { userId, scheduleHour: v.scheduleHour }, select: { id: true } })) {
      return text(`Error: another automation already runs at ${String(v.scheduleHour).padStart(2, "0")}:00.`);
    }
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
    const n = v.sourceConfig?.[v.jobBoard]?.companies.length ?? 0;
    return text(`Automation created (id: ${automation.id}): ${v.name}, ${v.jobBoard}, ${n} companies, daily at ${v.scheduleHour}:00.`);
  } catch (err: any) {
    return text(`Error: ${err?.message ?? "Unknown error"}`);
  }
}
