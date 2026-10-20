import "server-only";

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pLimit from "p-limit";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  SharedV3Warning,
} from "@ai-sdk/provider";
import { APICallError, UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { childEnvironment, promptToText } from "@/lib/ai/codex.server";

/**
 * Gemini CLI as an AI SDK language model, signed in with a Google account
 * (`gemini` once, interactively, with NO_BROWSER=true; the sign-in lives in
 * GEMINI_CLI_HOME). The second subscription CLI next to Codex: its own quota
 * (1,000 requests a day on a personal account), its own failure modes.
 *
 * One `gemini -p` per call in an empty scratch directory. Every built-in tool
 * is off through `tools.core: []` — an empty allowlist the policy engine turns
 * into a deny-all — and calls that bring tools are refused, as with Codex.
 */

const EXECUTABLE = process.env.GEMINI_EXECUTABLE || "gemini";
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 180_000;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

// ponytail: one call at a time, like Codex; raise via GEMINI_CONCURRENCY.
const limit = pLimit(Number(process.env.GEMINI_CONCURRENCY) || 1);

/** The settings the provider relies on, merged into whatever the sign-in wrote. */
export const REQUIRED_SETTINGS = {
  security: { auth: { selectedType: "oauth-personal" } },
  tools: { core: [] as string[] },
  mcpServers: {},
};

export function mergeSettings(current: Record<string, any>) {
  return {
    ...current,
    security: {
      ...current.security,
      auth: { ...current.security?.auth, ...REQUIRED_SETTINGS.security.auth },
    },
    tools: { ...current.tools, core: [] },
    mcpServers: {},
  };
}

// Written before every call rather than once at build time: the sign-in
// rewrites settings.json, and a missing `tools.core` would quietly hand the
// model a shell.
async function ensureSettings(home: string) {
  const dir = join(home, ".gemini");
  const file = join(dir, "settings.json");
  let current: Record<string, any> = {};
  try {
    current = JSON.parse(await readFile(file, "utf8"));
  } catch {
    /* first run */
  }
  const next = mergeSettings(current);
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(next, null, 2));
  }
}

export type GeminiErrorCode =
  | "configuration_error"
  | "auth_required"
  | "rate_limited"
  | "network_unavailable"
  | "invalid_output"
  | "provider_unavailable";

export function classifyGeminiError(text: string): GeminiErrorCode {
  const lowered = text.toLowerCase();
  if (/enoent|unknown argument|invalid value|not found: gemini/.test(lowered)) return "configuration_error";
  if (/auth method|interactive consent|login|unauthenticated|credentials|status:? 401|permission_denied/.test(lowered))
    return "auth_required";
  if (/quota|rate.?limit|resource_exhausted|status:? 429|too many requests/.test(lowered)) return "rate_limited";
  if (/network|enotfound|econnrefused|etimedout|timed out|fetch failed/.test(lowered)) return "network_unavailable";
  return "provider_unavailable";
}

const CODE_MESSAGES: Record<GeminiErrorCode, string> = {
  configuration_error: "Gemini CLI is not installed or rejected its arguments",
  auth_required: "Gemini CLI is not signed in; run `NO_BROWSER=true gemini` once for the server's GEMINI_CLI_HOME",
  rate_limited: "The Google account behind Gemini CLI hit its daily quota",
  network_unavailable: "Gemini CLI could not reach Google",
  invalid_output: "Gemini CLI returned something other than an answer",
  provider_unavailable: "Gemini CLI failed",
};

export class GeminiError extends APICallError {
  constructor(readonly code: GeminiErrorCode, detail?: string) {
    super({
      message: `${CODE_MESSAGES[code]}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      url: "gemini-cli",
      requestBodyValues: {},
      isRetryable: code === "network_unavailable",
    });
  }
}

export interface GeminiTurn {
  text: string;
  usage: { input: number; cachedInput: number; output: number; reasoning: number };
}

/**
 * The `--output-format json` envelope: `response`, `stats`, and `error` on
 * failure. Token counts sit per model under stats.models; they are summed, as
 * `auto` may route one call through more than one model.
 */
export function parseGeminiOutput(stdout: string): GeminiTurn {
  let out: any;
  try {
    out = JSON.parse(stdout.slice(stdout.indexOf("{")));
  } catch {
    throw new GeminiError("invalid_output", "the output is not JSON");
  }
  if (out?.error) {
    const detail = typeof out.error === "string" ? out.error : JSON.stringify(out.error);
    throw new GeminiError(classifyGeminiError(detail), detail);
  }
  if (typeof out?.response !== "string") throw new GeminiError("invalid_output", "no response field");
  // A tool call that the deny-all refused still shows up in the counters; an
  // answer that needed one is not an answer to trust.
  const toolCalls = out.stats?.tools?.totalCalls ?? 0;
  if (toolCalls > 0) throw new GeminiError("invalid_output", `the model attempted ${toolCalls} tool call(s)`);
  const usage = { input: 0, cachedInput: 0, output: 0, reasoning: 0 };
  for (const m of Object.values<any>(out.stats?.models ?? {})) {
    const t = m?.tokens ?? {};
    usage.input += t.prompt ?? t.input ?? 0;
    usage.cachedInput += t.cached ?? 0;
    usage.output += t.candidates ?? t.output ?? 0;
    usage.reasoning += t.thoughts ?? 0;
  }
  return { text: out.response, usage };
}

function homeDir() {
  const home = process.env.GEMINI_CLI_HOME;
  if (!home) throw new GeminiError("configuration_error", "GEMINI_CLI_HOME is not set");
  return home;
}

function runGemini(model: string, input: string, signal?: AbortSignal): Promise<GeminiTurn> {
  return limit(async () => {
    signal?.throwIfAborted();
    const home = homeDir();
    await ensureSettings(home);
    const workDir = await mkdtemp(join(tmpdir(), "jobsync-gemini-"));
    try {
      const argv = ["-p", "", "--output-format", "json", "--skip-trust", "--approval-mode", "default"];
      if (model && model !== "auto") argv.push("-m", model);
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(EXECUTABLE, argv, {
          cwd: workDir,
          env: { ...childEnvironment(), GEMINI_CLI_HOME: home, NO_BROWSER: "true" },
          stdio: ["pipe", "pipe", "pipe"],
        });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let bytes = 0;
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
          finish(() => reject(new GeminiError("network_unavailable", `no answer within ${TIMEOUT_MS} ms`)));
        }, TIMEOUT_MS);
        signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (c: Buffer) => {
          bytes += c.length;
          if (bytes > MAX_STDOUT_BYTES) {
            kill();
            finish(() => reject(new GeminiError("invalid_output", "the output is too large")));
            return;
          }
          out.push(c);
        });
        child.stderr.on("data", (c: Buffer) => err.push(c));
        child.on("error", (e) => finish(() => reject(new GeminiError(classifyGeminiError(String(e)), String(e)))));
        child.on("close", (code) => {
          const text = Buffer.concat(out).toString("utf8");
          // The JSON envelope carries the error on failure; only without it is
          // stderr the explanation.
          if (code !== 0 && !text.includes('"error"')) {
            const e = Buffer.concat(err).toString("utf8").trim();
            finish(() => reject(new GeminiError(classifyGeminiError(e), e)));
            return;
          }
          finish(() => resolve(text));
        });
        child.stdin.on("error", () => {});
        child.stdin.end(input);
      });
      return parseGeminiOutput(stdout);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

const UNSUPPORTED_SETTINGS = [
  "temperature", "topP", "topK", "presencePenalty", "frequencyPenalty",
  "seed", "stopSequences", "maxOutputTokens",
] as const;

export class GeminiCliLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "gemini-cli";
  readonly supportedUrls = {};

  constructor(readonly modelId: string) {}

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    if (options.tools?.length) {
      throw new UnsupportedFunctionalityError({
        functionality: "tool calls (Gemini CLI answers text only; the assistant chat needs another provider)",
      });
    }
    const warnings: SharedV3Warning[] = UNSUPPORTED_SETTINGS.filter((k) => options[k] !== undefined).map(
      (feature) => ({ type: "unsupported", feature }),
    );
    const turn = await runGemini(this.modelId, promptToText(options.prompt, options.responseFormat), options.abortSignal);
    const u = turn.usage;
    return {
      content: [{ type: "text", text: turn.text }],
      finishReason: { unified: "stop", raw: "response" },
      usage: {
        inputTokens: { total: u.input, noCache: u.input - u.cachedInput, cacheRead: u.cachedInput, cacheWrite: undefined },
        outputTokens: { total: u.output, text: u.output - u.reasoning, reasoning: u.reasoning },
      },
      warnings,
    };
  }

  // ponytail: one chunk at the end, as with Codex.
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

/** Same allowlist idea as Codex: one person's quota, a multi-user app. */
export async function isGeminiAllowed(userId: string | undefined): Promise<boolean> {
  const allowed = (process.env.GEMINI_ALLOWED_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return !!userId && allowed.includes(userId);
}

export const GEMINI_NOT_ALLOWED =
  "Gemini CLI is not enabled for this account (GEMINI_ALLOWED_USERS on the server)";

/**
 * Signed in = the cached OAuth file exists. A real check costs a request of
 * the daily quota on every automation run, so the first call tells the rest.
 */
export async function verifyGeminiLogin(): Promise<{ success: boolean; error?: string }> {
  try {
    const home = homeDir();
    const creds = JSON.parse(await readFile(join(home, ".gemini", "oauth_creds.json"), "utf8"));
    return creds?.refresh_token ? { success: true } : { success: false, error: CODE_MESSAGES.auth_required };
  } catch (e) {
    return {
      success: false,
      error: e instanceof GeminiError ? e.message : CODE_MESSAGES.auth_required,
    };
  }
}
