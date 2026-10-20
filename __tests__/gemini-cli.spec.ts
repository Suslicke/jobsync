/**
 * @vitest-environment node
 */
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A stand-in `gemini` that answers in the --output-format json envelope and
// records what it was started with, so the spawn path runs end to end.
const bin = mkdtempSync(join(tmpdir(), "fake-gemini-"));
const fake = join(bin, "gemini");
writeFileSync(
  fake,
  `#!/bin/sh
input=$(cat)
echo "$@" > "$GEMINI_CLI_HOME/argv.txt"
case "$input" in
  *QUOTA*) echo '{"error":{"type":"Error","message":"RESOURCE_EXHAUSTED: quota exceeded","code":429}}'; exit 1 ;;
  *TOOL*) echo '{"response":"done","stats":{"models":{},"tools":{"totalCalls":1}}}'; exit 0 ;;
esac
[ -n "$DATABASE_URL" ] && leaked=yes || leaked=no
echo "{\\"response\\":\\"leaked=$leaked\\",\\"stats\\":{\\"models\\":{\\"gemini-2.5-flash\\":{\\"tokens\\":{\\"input\\":90,\\"prompt\\":90,\\"candidates\\":6,\\"total\\":96,\\"cached\\":0,\\"thoughts\\":2,\\"tool\\":0}}},\\"tools\\":{\\"totalCalls\\":0}}}"
`,
);
chmodSync(fake, 0o755);
const home = mkdtempSync(join(tmpdir(), "gemini-home-"));
process.env.GEMINI_EXECUTABLE = fake;
process.env.GEMINI_CLI_HOME = home;
process.env.DATABASE_URL = "file:/secret.db";

const gemini = await import("@/lib/ai/gemini.server");
const { generateText } = await import("ai");

describe("mergeSettings", () => {
  it("forces the auth type and the empty tool allowlist over what the sign-in wrote", () => {
    const merged = gemini.mergeSettings({
      security: { auth: { selectedType: "gemini-api-key" }, folderTrust: { enabled: true } },
      tools: { core: ["run_shell_command"], sandbox: false },
      mcpServers: { github: { command: "x" } },
      ui: { theme: "dark" },
    });
    expect(merged.security.auth.selectedType).toBe("oauth-personal");
    expect(merged.security.folderTrust).toEqual({ enabled: true });
    expect(merged.tools).toEqual({ core: [], sandbox: false });
    expect(merged.mcpServers).toEqual({});
    expect(merged.ui).toEqual({ theme: "dark" });
  });
});

describe("parseGeminiOutput", () => {
  it("names a spent quota", () => {
    try {
      gemini.parseGeminiOutput('{"error":{"message":"RESOURCE_EXHAUSTED","code":429}}');
      expect.unreachable();
    } catch (e: any) {
      expect(e.code).toBe("rate_limited");
    }
  });

  it("does not take noise for an answer", () => {
    expect(() => gemini.parseGeminiOutput("Loaded cached credentials.")).toThrow(/not JSON/);
  });
});

describe("GeminiCliLanguageModel", () => {
  const model = new gemini.GeminiCliLanguageModel("flash");

  it("answers through the binary, without the database URL, with tools locked", async () => {
    const result = await generateText({ model, prompt: "hello" });
    expect(result.text).toBe("leaked=no");
    expect(result.usage.inputTokens).toBe(90);
    expect(result.usage.outputTokens).toBe(6);
    const settings = JSON.parse(readFileSync(join(home, ".gemini", "settings.json"), "utf8"));
    expect(settings.tools.core).toEqual([]);
    const argv = readFileSync(join(home, "argv.txt"), "utf8");
    expect(argv).toContain("--output-format json");
    expect(argv).toContain("--model=flash");
  });

  it("reports a spent quota as such", async () => {
    await expect(generateText({ model, prompt: "QUOTA" })).rejects.toThrow(/daily quota/);
  });

  it("refuses an answer that came after a tool call", async () => {
    await expect(generateText({ model, prompt: "TOOL" })).rejects.toThrow(/tool call/);
  });

  it("refuses a model name that would read as a flag", async () => {
    const evil = new gemini.GeminiCliLanguageModel("--approval-mode=yolo");
    await expect(generateText({ model: evil, prompt: "hi" })).rejects.toThrow(/model name/);
  });

  it("refuses a call that offers tools", async () => {
    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [{ type: "function", name: "x", inputSchema: { type: "object" } }],
      } as any),
    ).rejects.toThrow(/tool calls/);
  });
});

describe("verifyGeminiLogin and the allowlist", () => {
  afterEach(() => {
    delete process.env.GEMINI_ALLOWED_USERS;
  });

  it("is signed in only with a refresh token on disk", async () => {
    await expect(gemini.verifyGeminiLogin()).resolves.toMatchObject({ success: false });
    writeFileSync(join(home, ".gemini", "oauth_creds.json"), JSON.stringify({ refresh_token: "r" }));
    await expect(gemini.verifyGeminiLogin()).resolves.toEqual({ success: true });
  });

  it("lets in exactly the listed ids", async () => {
    await expect(gemini.isGeminiAllowed("u-1")).resolves.toBe(false);
    process.env.GEMINI_ALLOWED_USERS = "u-1, u-2";
    await expect(gemini.isGeminiAllowed("u-2")).resolves.toBe(true);
    await expect(gemini.isGeminiAllowed("u-3")).resolves.toBe(false);
  });
});
