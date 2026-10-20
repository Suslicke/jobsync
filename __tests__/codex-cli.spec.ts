/**
 * @vitest-environment node
 */
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A stand-in `codex` that prints a canned event stream, so the spawn path is
// exercised end to end without a network or a ChatGPT login.
const bin = mkdtempSync(join(tmpdir(), "fake-codex-"));
const fake = join(bin, "codex");
writeFileSync(
  fake,
  `#!/bin/sh
if [ "$1" = "login" ]; then echo "Logged in using ChatGPT"; exit 0; fi
input=$(cat)
case "$input" in
  *FAIL*) echo '{"type":"turn.failed","error":{"message":"usage limit reached"}}'; exit 1 ;;
  *TOOL*) echo '{"type":"turn.started"}'; echo '{"type":"item.completed","item":{"type":"command_execution"}}'; exit 0 ;;
esac
[ -n "$DATABASE_URL" ] && leaked=yes || leaked=no
echo '{"type":"thread.started"}'
echo '{"type":"turn.started"}'
echo "{\\"type\\":\\"item.completed\\",\\"item\\":{\\"type\\":\\"agent_message\\",\\"text\\":\\"leaked=$leaked\\"}}"
echo '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":7,"reasoning_output_tokens":2}}'
`,
);
chmodSync(fake, 0o755);
process.env.CODEX_EXECUTABLE = fake;
process.env.DATABASE_URL = "file:/secret.db";

vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.id === "u-owner" ? { email: "Owner@Example.com" } : { email: "other@example.com" },
      ),
    },
  },
}));

const codex = await import("@/lib/ai/codex.server");
const { generateText } = await import("ai");

describe("parseCodexEvents", () => {
  it("returns the last message and the turn's usage", () => {
    const turn = codex.parseCodexEvents(
      [
        '{"type":"thread.started"}',
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"type":"reasoning","text":"…"}}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"a\\":1}"}}',
        '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":3}}',
      ].join("\n"),
    );
    expect(turn.text).toBe('{"a":1}');
    expect(turn.usage).toMatchObject({ input: 5, output: 3 });
  });

  it("refuses an item that is not an answer, even an unknown new kind", () => {
    expect(() =>
      codex.parseCodexEvents('{"type":"item.started","item":{"type":"web_search"}}'),
    ).toThrow(/unexpected item/);
  });

  it("names a failed turn by its cause", () => {
    try {
      codex.parseCodexEvents('{"type":"turn.failed","error":{"message":"status 401 Unauthorized"}}');
      expect.unreachable();
    } catch (error: any) {
      expect(error.code).toBe("auth_required");
    }
  });

  it("does not take a turn that never completed for an empty answer", () => {
    expect(() => codex.parseCodexEvents('{"type":"turn.started"}')).toThrow(/never completed/);
  });
});

describe("promptToText", () => {
  it("keeps roles and asks for JSON against the schema", () => {
    const text = codex.promptToText(
      [
        { role: "system", content: "Score the job." },
        { role: "user", content: [{ type: "text", text: "Resume and job" }] },
      ],
      { type: "json", schema: { type: "object", properties: { score: { type: "number" } } } },
    );
    expect(text).toContain("SYSTEM:\nScore the job.");
    expect(text).toContain("USER:\nResume and job");
    expect(text).toContain('"score":{"type":"number"}');
  });
});

describe("childEnvironment", () => {
  it("passes the sign-in location and drops the app's secrets", () => {
    const env = codex.childEnvironment({
      PATH: "/bin",
      CODEX_HOME: "/data/codex",
      DATABASE_URL: "file:x",
      ENCRYPTION_KEY: "k",
      OPENAI_API_KEY: "sk",
    });
    expect(env).toEqual({ PATH: "/bin", CODEX_HOME: "/data/codex" });
  });
});

describe("CodexCliLanguageModel", () => {
  const model = new codex.CodexCliLanguageModel("gpt-test");

  it("answers through the binary without handing it the database URL", async () => {
    const result = await generateText({ model, prompt: "hello", temperature: 0.3 });
    expect(result.text).toBe("leaked=no");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: "unsupported", feature: "temperature" }),
    );
  });

  it("reports a spent plan as such", async () => {
    await expect(generateText({ model, prompt: "FAIL" })).rejects.toThrow(/usage limit/);
  });

  it("refuses a call that offers tools instead of answering without them", async () => {
    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [{ type: "function", name: "x", inputSchema: { type: "object" } }],
      } as any),
    ).rejects.toThrow(/tool calls/);
  });

  it("refuses an answer that came with a command", async () => {
    await expect(generateText({ model, prompt: "TOOL" })).rejects.toThrow(/unexpected item/);
  });

  it("checks the sign-in", async () => {
    await expect(codex.verifyCodexLogin()).resolves.toEqual({ success: true });
  });
});

describe("isCodexAllowed", () => {
  afterEach(() => {
    delete process.env.CODEX_ALLOWED_USERS;
  });

  it("lets nobody in when the allowlist is unset", async () => {
    await expect(codex.isCodexAllowed("u-owner")).resolves.toBe(false);
  });

  it("matches a listed email regardless of case, and only that account", async () => {
    process.env.CODEX_ALLOWED_USERS = "owner@example.com";
    await expect(codex.isCodexAllowed("u-owner")).resolves.toBe(true);
    await expect(codex.isCodexAllowed("u-other")).resolves.toBe(false);
    await expect(codex.isCodexAllowed(undefined)).resolves.toBe(false);
  });

  it("matches a listed user id without a lookup", async () => {
    process.env.CODEX_ALLOWED_USERS = " u-7 , u-9 ";
    await expect(codex.isCodexAllowed("u-9")).resolves.toBe(true);
  });
});
