import "server-only";
import { z } from "zod";
import { NextRequest } from "next/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_CONSTANTS } from "@/lib/constants";
import { runAsUser, type ActingUser } from "@/lib/mcp/actingUser";
import { MCP_ACTIONS, type McpActionEntry } from "./catalog.generated";
import * as resumeRoute from "@/app/api/profile/resume/route";
import * as resumeImportRoute from "@/app/api/ai/resume/import/route";
import * as automationRunRoute from "@/app/api/automations/[id]/run/route";
import * as automationCancelRoute from "@/app/api/automations/[id]/cancel/route";
import * as automationLogsRoute from "@/app/api/automations/[id]/logs/route";
import * as automationLogsClearRoute from "@/app/api/automations/[id]/logs/clear/route";
import * as jobsExportRoute from "@/app/api/jobs/export/route";
import * as apiKeyVerifyRoute from "@/app/api/settings/api-keys/verify/route";

// Every server action over MCP, for tokens with the "full" scope.
//
// Actions run unchanged: runAsUser() makes auth() return the token owner, so the
// usual ownership checks and validation apply. The generator already skips the
// dangerous ones; this list is the second lock and is checked at runtime.
const DENY = new Set(["signup", "authenticate", "createMcpToken", "getOllamaBaseUrl"]);

// Domains that get one MCP tool per action. The rest stay reachable through
// call_action, so the tool list does not flood the agent's context.
const DEFAULT_TOOL_DOMAINS = ["profile", "question", "task", "job", "note", "contact", "automation", "fit", "feedback"];

const MAX_RESULT_CHARS = 40_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

type ToolResult = { content: Array<{ type: "text"; text: string }> };
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

export const allowedActions = (): [string, McpActionEntry][] =>
  Object.entries(MCP_ACTIONS).filter(
    ([key, e]) => !DENY.has(key.split(".")[1].split("@")[0]) && !e.params.some((p) => p.name === "userId"),
  );

// Server actions validate with zod schemas that expect Date objects; JSON carries strings.
// Only nested values are revived — a top-level string parameter stays a string.
function reviveDates(value: unknown, nested = false): unknown {
  if (typeof value === "string") return nested && ISO_DATE.test(value) ? new Date(value) : value;
  if (Array.isArray(value)) return value.map((v) => reviveDates(v, true));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveDates(v, true)]));
  }
  return value;
}

function serialize(result: unknown): string {
  const json = JSON.stringify(result ?? null, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  return json.length > MAX_RESULT_CHARS
    ? `${json.slice(0, MAX_RESULT_CHARS)}\n… truncated (${json.length} chars). Narrow the query (page/limit/filters).`
    : json;
}

function schemaText(entry: McpActionEntry, paramType: string): string | undefined {
  const name = /typeof\s+([A-Za-z0-9_]+)/.exec(paramType)?.[1];
  const schema = name ? entry.schemas[name] : undefined;
  if (!schema) return undefined;
  try {
    return JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" }));
  } catch {
    return undefined;
  }
}

function describe(key: string, entry: McpActionEntry): string {
  const lines = [`${key}(${entry.signature})`];
  if (entry.doc) lines.push(entry.doc);
  for (const p of entry.params) {
    const schema = schemaText(entry, p.type);
    lines.push(`- ${p.name}${p.optional ? "?" : ""}: ${p.type}${schema ? `\n  JSON schema: ${schema}` : ""}`);
  }
  lines.push("Dates inside objects: ISO-8601 strings (converted to Date).");
  return lines.join("\n");
}

const toolName = (key: string) =>
  key
    .replace("@", "_")
    .replace(".", "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .slice(0, 64);

export function registerActionTools(
  server: McpServer,
  ctx: { user: ActingUser; tokenName: string; scopes: string[] },
) {
  const full = ctx.scopes.includes(APP_CONSTANTS.MCP_FULL_SCOPE);
  const actions = new Map(allowedActions());

  const guard = (): ToolResult | null =>
    full ? null : text(`Insufficient scope. Required: ${APP_CONSTANTS.MCP_FULL_SCOPE} — create a token with "Full access" in Settings → MCP Access.`);

  async function invoke(key: string, rawArgs: unknown): Promise<ToolResult> {
    const entry = actions.get(key);
    if (!entry) return text(`Unknown action "${key}". Call list_actions.`);
    const args = Array.isArray(rawArgs)
      ? rawArgs
      : entry.params.map((p) => (rawArgs as Record<string, unknown> | undefined)?.[p.name]);
    // Trailing undefined arguments let default parameter values apply.
    while (args.length && args[args.length - 1] === undefined) args.pop();
    const started = Date.now();
    try {
      const result = await runAsUser(ctx.user, async () => entry.fn(...(reviveDates(args) as unknown[])));
      console.info(JSON.stringify({ mcpAudit: key, user: ctx.user.id, token: ctx.tokenName, ok: true, ms: Date.now() - started }));
      return text(serialize(result));
    } catch (err: any) {
      console.info(JSON.stringify({ mcpAudit: key, user: ctx.user.id, token: ctx.tokenName, ok: false, error: err?.message }));
      return text(`Error: ${err?.message ?? "Unknown error"}`);
    }
  }

  // --- catalog tools ---------------------------------------------------------
  server.tool(
    "list_actions",
    "List every platform action callable over MCP (resumes, questions, tasks, jobs, notes, contacts, companies, automations, activities, cover letters, tags, settings). Optional domain filter.",
    { domain: z.string().optional().describe("e.g. profile, question, task, job, contact, automation") },
    async ({ domain }) => {
      const denied = guard();
      if (denied) return denied;
      const rows = [...actions]
        .filter(([key]) => !domain || key.startsWith(`${domain}.`))
        .map(([key, e]) => `${key}(${e.signature})${e.doc ? ` — ${e.doc}` : ""}`);
      return text(rows.length ? rows.join("\n") : `No actions for domain "${domain}".`);
    },
  );

  server.tool(
    "describe_action",
    "Parameters of one action, with JSON schemas for form-data parameters.",
    { action: z.string().describe("Key from list_actions, e.g. profile.addExperience") },
    async ({ action }) => {
      const denied = guard();
      if (denied) return denied;
      const entry = actions.get(action);
      return entry ? text(describe(action, entry)) : text(`Unknown action "${action}". Call list_actions.`);
    },
  );

  server.tool(
    "call_action",
    "Call any platform action as the token owner, with the same validation and ownership checks as the app UI.",
    {
      action: z.string().describe("Key from list_actions, e.g. task.updateTaskStatus"),
      args: z
        .union([z.record(z.string(), z.any()), z.array(z.any())])
        .optional()
        .describe("Named parameters as an object (preferred) or positional as an array."),
    },
    async ({ action, args }) => guard() ?? invoke(action, args),
  );

  // --- one tool per action for the everyday domains --------------------------
  const domains = (process.env.MCP_TOOL_DOMAINS ?? DEFAULT_TOOL_DOMAINS.join(","))
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  if (full) {
    for (const [key, entry] of actions) {
      if (!domains.includes("all") && !domains.includes(key.split(".")[0])) continue;
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const p of entry.params) {
        const schema = schemaText(entry, p.type);
        const field = z.any().describe(`${p.type}${schema ? ` — JSON schema: ${schema}` : ""}`);
        shape[p.name] = p.optional ? field.optional() : field;
      }
      server.tool(toolName(key), `${key}(${entry.signature})${entry.doc ? ` — ${entry.doc}` : ""}`, shape, async (input) =>
        invoke(key, input),
      );
    }
  }

  // --- files and route handlers ----------------------------------------------
  const asRoute = async (fn: () => Promise<Response | undefined>, label: string): Promise<ToolResult> => {
    const denied = guard();
    if (denied) return denied;
    try {
      const res = await runAsUser(ctx.user, fn);
      if (!res) return text(`Error: ${label} returned no response`);
      console.info(JSON.stringify({ mcpAudit: label, user: ctx.user.id, token: ctx.tokenName, status: res.status }));
      const type = res.headers.get("content-type") ?? "";
      const body = /json|text|csv/.test(type)
        ? await res.text()
        : `<${type || "binary"} ${(await res.arrayBuffer()).byteLength} bytes>`;
      return text(`HTTP ${res.status}\n${body.length > MAX_RESULT_CHARS ? `${body.slice(0, MAX_RESULT_CHARS)}\n… truncated` : body}`);
    } catch (err: any) {
      return text(`Error: ${err?.message ?? "Unknown error"}`);
    }
  };
  const url = (path: string) => `http://localhost${path}`;
  const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

  server.tool(
    "upload_resume",
    "Upload a resume file (PDF or .docx, base64) — creates a new resume, or replaces the file of an existing one when resumeId is given. Fill sections afterwards with profile_* tools or import_resume_with_ai.",
    {
      title: z.string().min(1),
      fileName: z.string().describe("e.g. cv.pdf"),
      contentBase64: z.string(),
      resumeId: z.string().optional(),
    },
    async ({ title, fileName, contentBase64, resumeId }) =>
      asRoute(async () => {
        const type = fileName.toLowerCase().endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf";
        const form = new FormData();
        form.set("title", title);
        form.set("file", new File([Buffer.from(contentBase64, "base64")], fileName, { type }));
        if (resumeId) form.set("id", resumeId);
        return resumeRoute.POST(new NextRequest(url("/api/profile/resume"), { method: "POST", body: form }));
      }, "upload_resume"),
  );

  server.tool(
    "import_resume_with_ai",
    "Extract structured sections from a resume's uploaded file with the user's AI provider. Returns review cards; save them with profile_* tools or call_action resumeImport.resolveImportCard.",
    { resumeId: z.string(), provider: z.string().describe("openai, gemini, deepseek, openrouter, ollama"), model: z.string() },
    async ({ resumeId, provider, model }) =>
      asRoute(
        () =>
          resumeImportRoute.POST(
            new NextRequest(url("/api/ai/resume/import"), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ resumeId, selectedModel: { provider, model } }),
            }),
          ),
        "import_resume_with_ai",
      ),
  );

  server.tool("run_automation", "Run an automation now (manual runs are rate-limited by the app).", { id: z.string() }, async ({ id }) =>
    asRoute(() => automationRunRoute.POST(new NextRequest(url(`/api/automations/${id}/run`), { method: "POST" }), idParams(id)), "run_automation"),
  );
  server.tool("cancel_automation_run", "Abort the running automation.", { id: z.string() }, async ({ id }) =>
    asRoute(() => automationCancelRoute.POST(new NextRequest(url(`/api/automations/${id}/cancel`), { method: "POST" }), idParams(id)), "cancel_automation_run"),
  );
  server.tool("get_automation_logs", "Logs of the current or last run of an automation.", { id: z.string() }, async ({ id }) =>
    asRoute(() => automationLogsRoute.GET(new NextRequest(url(`/api/automations/${id}/logs`)), idParams(id)), "get_automation_logs"),
  );
  server.tool("clear_automation_logs", "Clear an automation's logs.", { id: z.string() }, async ({ id }) =>
    asRoute(() => automationLogsClearRoute.POST(new NextRequest(url(`/api/automations/${id}/logs/clear`), { method: "POST" }), idParams(id)), "clear_automation_logs"),
  );
  server.tool("export_jobs", "Export all jobs (CSV).", {}, async () =>
    asRoute(() => jobsExportRoute.POST(), "export_jobs"),
  );
  server.tool(
    "verify_api_key",
    "Check an AI provider key before saving it with call_action apiKey.saveApiKey.",
    { provider: z.string(), key: z.string() },
    async ({ provider, key }) =>
      asRoute(
        () =>
          apiKeyVerifyRoute.POST(
            new NextRequest(url("/api/settings/api-keys/verify"), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ provider, key }),
            }),
          ),
        "verify_api_key",
      ),
  );
}
