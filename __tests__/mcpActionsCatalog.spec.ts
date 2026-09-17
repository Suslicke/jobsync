import fs from "node:fs";
import path from "node:path";

// The MCP action catalog is generated from src/actions. These checks fail the
// build if regeneration ever exposes something that must stay off MCP.
const catalog = fs.readFileSync(
  path.join(__dirname, "../src/lib/mcp/actions/catalog.generated.ts"),
  "utf8",
);
const register = fs.readFileSync(path.join(__dirname, "../src/lib/mcp/actions/register.ts"), "utf8");

const entries = [...catalog.matchAll(/^ {2}"([^"]+)": \{ fn: [^,]+, signature: ("(?:[^"\\]|\\.)*"), params: (\[.*?\]), doc: /gm)].map(
  (m) => ({ key: m[1], signature: JSON.parse(m[2]) as string, params: JSON.parse(m[3]) as { name: string }[] }),
);

describe("MCP action catalog", () => {
  it("is not empty", () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it.each(["signup", "authenticate", "createMcpToken", "getOllamaBaseUrl"])("does not expose %s", (name) => {
    expect(entries.map((e) => e.key.split(".")[1].split("@")[0])).not.toContain(name);
    expect(register).toContain(`"${name}"`);
  });

  it("exposes no mock-data actions", () => {
    expect(catalog).not.toMatch(/@\/actions\/mock\.actions/);
  });

  it("has no action that takes a userId parameter", () => {
    const offenders = entries.filter((e) => e.params.some((p) => p.name === "userId")).map((e) => e.key);
    expect(offenders).toEqual([]);
  });
});
