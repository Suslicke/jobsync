import { z } from "zod";
import prisma from "@/lib/db";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";
import { getDefaultResumeForUser } from "@/lib/jobs/getDefaultResumeForUser";
import { preprocessResume } from "@/lib/ai/tools/preprocessing";
import { buildMatchDirective } from "@/lib/mcp/tools/matchDirective";
import type { DescriptionCompleteness } from "@/models/job.model";

// Local addition: add_job only offers a match at creation time. This hands the agent
// the backlog — MCP-created jobs with a real description and no score yet.
export const McpGetMatchQueueInputShape = {
  limit: z.number().int().min(1).max(10).optional().describe("How many jobs to return (default 3; max 5, or 10 with compact)."),
  compact: z
    .boolean()
    .optional()
    .describe("Resume and scoring instructions once, then only job headers and descriptions. Use for batch scoring."),
};
export const McpGetMatchQueueSchema = z.object(McpGetMatchQueueInputShape);

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function handleGetMatchQueue(input: z.infer<typeof McpGetMatchQueueSchema>, userId: string) {
  const rateCheck = checkMcpRateLimit(userId);
  if (!rateCheck.allowed) return text(`Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.`);

  const resume = await getDefaultResumeForUser(userId);
  if (!resume) return text("No default resume set — set one in Profile → Resumes, then retry.");
  const pre = await preprocessResume(resume);
  if (!pre.success) return text("Default resume couldn't be used for matching — check it in Profile → Resumes.");

  // Two sources: MCP-created jobs with a usable description and no score, and
  // automation-discovered jobs still waiting in Discovered Jobs that no AI provider scored.
  const where = {
    userId,
    OR: [
      { createdVia: { not: null }, matchScore: null, descriptionCompleteness: { in: ["partial", "full"] } },
      { automationId: { not: null }, discoveryStatus: "new", matchData: { contains: '"analyzed":false' }, description: { not: "" } },
    ],
  };
  const [remaining, jobs] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(input.limit ?? 3, input.compact ? 10 : 5),
      select: {
        id: true, description: true, descriptionCompleteness: true, jobUrl: true, automationId: true,
        Company: { select: { label: true } }, JobTitle: { select: { label: true } }, Status: { select: { label: true } },
      },
    }),
  ]);
  if (!jobs.length) return text("Match queue is empty — every job with a usable description already has a score.");

  const header = `${remaining} job(s) without a match score; returning ${jobs.length}. `;
  const job = (j: (typeof jobs)[number], i: number) =>
    `=== JOB ${i + 1}/${jobs.length}: ${j.Company.label} — ${j.JobTitle.label} (status: ${j.Status.label}${j.automationId ? ", discovered by automation" : ""})\n` +
    `jobId: ${j.id}${j.jobUrl ? `\nurl: ${j.jobUrl}` : ""}\n\n` +
    // Discovered listings arrive as HTML; tags cost tokens and carry no signal for scoring.
    `JOB DESCRIPTION:\n${j.description.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n")}`;

  if (input.compact) {
    // The directive is identical apart from the job id, so it is shown once with a placeholder.
    return text(
      header +
        `Score every job below against this resume, then save all with save_match_results_batch.\n\n` +
        buildMatchDirective("<jobId>", resume.id!, pre.data.normalizedText, "full", "update") +
        `\n\n` +
        jobs.map(job).join("\n\n"),
    );
  }

  return text(
    header +
      `Score each one and call save_match_result per job (or save_match_results_batch), then call get_match_queue again.\n\n` +
      jobs
        .map(
          (j, i) =>
            `${job(j, i)}\n\n` +
            buildMatchDirective(j.id, resume.id!, pre.data.normalizedText, (j.descriptionCompleteness ?? "full") as DescriptionCompleteness, "update"),
        )
        .join("\n\n"),
  );
}
