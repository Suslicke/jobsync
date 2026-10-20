import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pLimit from "p-limit";
import db from "@/lib/db";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";
import { APICallError, UnsupportedFunctionalityError } from "@ai-sdk/provider";

/**
 * Codex CLI as an AI SDK language model. It signs in with a ChatGPT
 * subscription (`codex login`, kept in CODEX_HOME), so no API key is stored
 * anywhere in JobSync.
 *
 * One `codex exec` per call, with everything that could act on the machine
 * switched off: no shell, no web search, no project docs, a read-only sandbox
 * in an empty scratch directory. It answers text and nothing else — a call
 * that brings tools is refused rather than quietly answered without them,
 * because an assistant that cannot act must not be able to say it did.
 */

const EXECUTABLE = process.env.CODEX_EXECUTABLE || "codex";
const TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS) || 180_000;
// bubblewrap inside a container needs user namespaces; where the host denies
// them, `danger-full-access` is the honest alternative, since the shell is off.
const SANDBOX = process.env.CODEX_SANDBOX || "read-only";
const REASONING_EFFORT = process.env.CODEX_REASONING_EFFORT || "low";
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

// ponytail: one call at a time for the whole process — a ChatGPT plan has a
// usage window, not a request budget, and a burst of automation matches would
// spend it in minutes. Raise via CODEX_CONCURRENCY if the plan allows.
const limit = pLimit(Number(process.env.CODEX_CONCURRENCY) || 1);

// Only what the binary needs to run and find its sign-in. Database URLs,
// AUTH_SECRET, ENCRYPTION_KEY and the other providers' keys stay out of it.
const ENV_ALLOWLIST = new Set([
  "path", "home", "user", "logname", "lang", "lc_all", "tmp", "tmpdir",
  "codex_home", "xdg_config_home", "http_proxy", "https_proxy", "all_proxy",
  "no_proxy", "ssl_cert_file", "ssl_cert_dir",
]);

export function childEnvironment(env: Record<string, string | undefined> = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => ENV_ALLOWLIST.has(k.toLowerCase())),
  ) as NodeJS.ProcessEnv;
}

export function buildArgv(model: string, workDir: string): string[] {
  return [
    "-a", "never", "exec",
    "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check",
    "-C", workDir, "-m", model, "-s", SANDBOX,
    "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "multi_agent",
    "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0",
    "-c", `model_reasoning_effort="${REASONING_EFFORT}"`,
    "--color", "never", "--json", "-",
  ];
}

/** Flattens the chat-shaped prompt into the single text Codex reads on stdin. */
export function promptToText(
  prompt: LanguageModelV3Prompt,
  responseFormat?: LanguageModelV3CallOptions["responseFormat"],
): string {
  const parts: string[] = [];
  for (const message of prompt) {
    if (message.role === "system") {
      parts.push(`SYSTEM:\n${message.content}`);
      continue;
    }
    const text = message.content
      .map((part) => {
        if (part.type === "text" || part.type === "reasoning") return part.text;
        if (part.type === "file") {
          throw new UnsupportedFunctionalityError({ functionality: "file parts in Codex CLI prompts" });
        }
        // Tool traffic only appears when tools were offered, which is refused
        // before this runs; anything else is dropped as noise.
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) parts.push(`${message.role.toUpperCase()}:\n${text}`);
  }
  // ponytail: the schema goes into the prompt, not --output-schema. Codex
  // enforces strict schemas only (every key required, no extra keys), and the
  // zod schemas here have optional fields; the AI SDK validates the answer
  // against the schema anyway. Switch to --output-schema once they are strict.
  if (responseFormat?.type === "json") {
    parts.push(
      "Answer with a single JSON value and nothing else: no prose, no code fences." +
        (responseFormat.schema
          ? `\nIt must match this JSON Schema:\n${JSON.stringify(responseFormat.schema)}`
          : ""),
    );
  }
  return parts.join("\n\n");
}

export type CodexErrorCode =
  | "configuration_error"
  | "auth_required"
  | "rate_limited"
  | "network_unavailable"
  | "invalid_output"
  | "provider_unavailable";

export function classifyCodexError(text: string): CodexErrorCode {
  const lowered = text.toLowerCase();
  if (/unexpected argument|unknown option|unrecognized option|invalid configuration|invalid schema|no such file|enoent/.test(lowered))
    return "configuration_error";
  if (/invalid_api_key|unauthorized|authentication|status:? 401|not logged in|login/.test(lowered))
    return "auth_required";
  if (/rate_limit|too many requests|status:? 429|usage limit/.test(lowered)) return "rate_limited";
  if (/connection failed|error sending request|network|dns|connection refused|timed out/.test(lowered))
    return "network_unavailable";
  return "provider_unavailable";
}

const CODE_MESSAGES: Record<CodexErrorCode, string> = {
  configuration_error: "Codex CLI is not installed or rejected its arguments",
  auth_required: "Codex CLI is not signed in; run `codex login` for the server's CODEX_HOME",
  rate_limited: "The ChatGPT plan behind Codex CLI hit its usage limit",
  network_unavailable: "Codex CLI could not reach OpenAI",
  invalid_output: "Codex CLI returned something other than an answer",
  provider_unavailable: "Codex CLI failed",
};

export class CodexError extends APICallError {
  constructor(readonly code: CodexErrorCode, detail?: string) {
    super({
      message: `${CODE_MESSAGES[code]}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      url: "codex-cli",
      requestBodyValues: {},
      // Worth retrying only when the cause can pass on its own.
      isRetryable: code === "network_unavailable",
    });
  }
}

export interface CodexTurn {
  text: string;
  usage: { input: number; cachedInput: number; output: number; reasoning: number };
}

/**
 * Reads the JSONL event stream of one `codex exec --json` turn. Anything but a
 * message or reasoning item means the model did something other than answer,
 * and that is refused even though the shell is off — a new item type in a
 * later Codex release must not slip through as text.
 */
export function parseCodexEvents(stdout: string): CodexTurn {
  let text: string | undefined;
  let usage: CodexTurn["usage"] | undefined;
  let failure: string | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      throw new CodexError("invalid_output", "a line of the event stream is not JSON");
    }
    const kind = event?.type;
    if (typeof kind !== "string") throw new CodexError("invalid_output", "an event has no type");
    if (kind.startsWith("item.")) {
      const itemType = event.item?.type;
      if (itemType === "agent_message") {
        if (kind === "item.completed" && typeof event.item.text === "string") text = event.item.text;
      } else if (itemType !== "reasoning") {
        throw new CodexError("invalid_output", `unexpected item "${itemType}"`);
      }
    } else if (kind === "turn.completed") {
      const u = event.usage ?? {};
      usage = {
        input: u.input_tokens ?? 0,
        cachedInput: u.cached_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        reasoning: u.reasoning_output_tokens ?? 0,
      };
    } else if (kind === "error" || kind === "turn.failed") {
      failure = JSON.stringify(event);
    }
  }
  if (failure) throw new CodexError(classifyCodexError(failure), failure);
  if (text === undefined || !usage) throw new CodexError("invalid_output", "the turn never completed");
  return { text, usage };
}

function runCodex(model: string, input: string, signal?: AbortSignal): Promise<CodexTurn> {
  return limit(async () => {
    signal?.throwIfAborted();
    const workDir = await mkdtemp(join(tmpdir(), "jobsync-codex-"));
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(EXECUTABLE, buildArgv(model, workDir), {
          cwd: workDir,
          env: childEnvironment(),
          stdio: ["pipe", "pipe", "pipe"],
        });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let outBytes = 0;
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          fn();
        };
        const kill = () => child.kill("SIGKILL");
        const onAbort = () => {
          kill();
          finish(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
        };
        const timer = setTimeout(() => {
          kill();
          finish(() => reject(new CodexError("network_unavailable", `no answer within ${TIMEOUT_MS} ms`)));
        }, TIMEOUT_MS);
        signal?.addEventListener("abort", onAbort, { once: true });

        child.stdout.on("data", (chunk: Buffer) => {
          outBytes += chunk.length;
          if (outBytes > MAX_STDOUT_BYTES) {
            kill();
            finish(() => reject(new CodexError("invalid_output", "the event stream is too large")));
            return;
          }
          out.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
        child.on("error", (error) =>
          finish(() => reject(new CodexError(classifyCodexError(String(error)), String(error)))),
        );
        child.on("close", (code) => {
          const stdoutText = Buffer.concat(out).toString("utf8");
          // A failed turn is reported in the stream itself, which says more
          // than the exit code does — so the stream is read first.
          if (code !== 0 && !stdoutText.includes('"turn.failed"') && !stdoutText.includes('"type":"error"')) {
            const stderrText = Buffer.concat(err).toString("utf8");
            finish(() => reject(new CodexError(classifyCodexError(stderrText), stderrText.trim())));
            return;
          }
          finish(() => resolve(stdoutText));
        });
        child.stdin.on("error", () => {});
        child.stdin.end(input);
      });
      return parseCodexEvents(stdout);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

function toUsage(u: CodexTurn["usage"]): LanguageModelV3Usage {
  return {
    inputTokens: { total: u.input, noCache: u.input - u.cachedInput, cacheRead: u.cachedInput, cacheWrite: undefined },
    outputTokens: { total: u.output, text: u.output - u.reasoning, reasoning: u.reasoning },
  };
}

// Sampling knobs Codex does not expose. Said out loud instead of ignored.
const UNSUPPORTED_SETTINGS = [
  "temperature", "topP", "topK", "presencePenalty", "frequencyPenalty",
  "seed", "stopSequences", "maxOutputTokens",
] as const;

export class CodexCliLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "codex-cli";
  readonly supportedUrls = {};

  constructor(readonly modelId: string) {}

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    if (options.tools?.length) {
      throw new UnsupportedFunctionalityError({
        functionality: "tool calls (Codex CLI answers text only; the assistant chat needs another provider)",
      });
    }
    const warnings: SharedV3Warning[] = UNSUPPORTED_SETTINGS.filter(
      (key) => options[key] !== undefined,
    ).map((setting) => ({ type: "unsupported", feature: setting }));

    const turn = await runCodex(
      this.modelId,
      promptToText(options.prompt, options.responseFormat),
      options.abortSignal,
    );
    return {
      content: [{ type: "text", text: turn.text }],
      finishReason: { unified: "stop", raw: "turn.completed" },
      usage: toUsage(turn.usage),
      warnings,
    };
  }

  // ponytail: one chunk at the end. Codex streams events, not tokens, so a
  // token-by-token stream would only be the same answer cut into pieces.
  async doStream(options: LanguageModelV3CallOptions) {
    const result = await this.doGenerate(options);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: result.warnings });
        controller.enqueue({ type: "text-start", id: "0" });
        controller.enqueue({ type: "text-delta", id: "0", delta: text });
        controller.enqueue({ type: "text-end", id: "0" });
        controller.enqueue({ type: "finish", finishReason: result.finishReason, usage: result.usage });
        controller.close();
      },
    });
    return { stream };
  }
}

/**
 * The sign-in is one person's ChatGPT plan, and JobSync is multi-user: every
 * account on the instance would otherwise spend it. CODEX_ALLOWED_USERS lists
 * who may (user ids or emails, comma-separated); unset means nobody.
 */
export async function isCodexAllowed(userId: string | undefined): Promise<boolean> {
  const allowed = (process.env.CODEX_ALLOWED_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!userId || allowed.length === 0) return false;
  if (allowed.includes(userId.toLowerCase())) return true;
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user?.email && allowed.includes(user.email.toLowerCase());
}

export const CODEX_NOT_ALLOWED =
  "Codex CLI is not enabled for this account (CODEX_ALLOWED_USERS on the server)";

/** `codex login status`, for the settings check and the automation preflight. */
export async function verifyCodexLogin(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(EXECUTABLE, ["login", "status"], { env: childEnvironment() });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ success: false, error: `${CODE_MESSAGES.configuration_error}: ${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(
        // "Not logged in" contains "logged in", so the match is anchored.
        code === 0 && /^\s*logged in/i.test(output)
          ? { success: true }
          : { success: false, error: CODE_MESSAGES.auth_required },
      );
    });
  });
}
