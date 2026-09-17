import { z } from "zod";
import prisma from "@/lib/db";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";

// Local addition: the UI's createTask is a session-bound server action, so MCP gets its own entry point.
export const McpAddTaskInputShape = {
  title: z.string().min(2).max(200).describe("Short task title, e.g. 'Follow up with the recruiter'."),
  description: z.string().max(2000).optional().describe("Details, links, next step."),
  status: z
    .enum(["in-progress", "complete", "needs-attention", "cancelled"])
    .optional()
    .describe("Defaults to 'in-progress'."),
  priority: z.number().int().min(0).max(10).optional().describe("0-10, higher is more important. Defaults to 5."),
  dueDate: z.string().datetime({ offset: true }).optional().describe("ISO-8601 datetime; must not be in the past."),
};
export const McpAddTaskSchema = z.object(McpAddTaskInputShape);

export async function handleAddTask(
  input: z.infer<typeof McpAddTaskSchema>,
  userId: string,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const rateCheck = checkMcpRateLimit(userId);
  if (!rateCheck.allowed) {
    return { content: [{ type: "text", text: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.` }] };
  }

  const dueDate = input.dueDate ? new Date(input.dueDate) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dueDate && dueDate < today) {
    return { content: [{ type: "text", text: "Error: due date cannot be in the past." }] };
  }

  try {
    const task = await prisma.task.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "in-progress",
        priority: input.priority ?? 5,
        percentComplete: input.status === "complete" ? 100 : 0,
        dueDate,
        userId,
      },
    });
    return { content: [{ type: "text", text: `Task created (id: ${task.id}): ${task.title}` }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? "Unknown error"}` }] };
  }
}
