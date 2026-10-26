/**
 * @vitest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { PrismaClient } from "@prisma/client";
import { GET } from "@/app/hub/v1/summary/route";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { createMcpToken, revokeMcpToken } from "@/actions/mcpToken.actions";
import { startOfDayInTimeZone } from "@/lib/hub/summary";
import { hashToken } from "@/lib/mcp/tokens";

vi.mock("@prisma/client", () => {
  const mPrismaClient = {
    mcpAccessToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    job: { count: vi.fn() },
    task: { count: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return { PrismaClient: vi.fn(function () { return mPrismaClient; }) };
});

vi.mock("@/actions/shared", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1", name: "Owner", email: "owner@example.com" })),
}));

const prisma = new PrismaClient() as any;

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/hub-protocol.v1.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

// In-memory token table keyed by hash, so revoke (delete) really removes the row.
let tokens: Map<string, any>;

function putToken(plaintext: string, scopes: string[], extra: Record<string, unknown> = {}) {
  const row = {
    id: `id-${plaintext}`,
    userId: "user-1",
    name: `name-${plaintext}`,
    tokenHash: hashToken(plaintext),
    tokenPrefix: plaintext.slice(0, 12),
    scopes: JSON.stringify(scopes),
    expiresAt: new Date(Date.now() + 86_400_000),
    lastUsedAt: null,
    createdAt: new Date(),
    ...extra,
  };
  tokens.set(row.tokenHash, row);
  return row;
}

function get(token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return GET(new Request("http://localhost:3737/hub/v1/summary", { headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  tokens = new Map();
  prisma.mcpAccessToken.findUnique.mockImplementation(async ({ where }: any) => tokens.get(where.tokenHash) ?? null);
  prisma.mcpAccessToken.update.mockResolvedValue({});
  prisma.mcpAccessToken.delete.mockImplementation(async ({ where }: any) => {
    for (const [hash, row] of tokens) {
      if (row.id === where.id && row.userId === where.userId) tokens.delete(hash);
    }
    return {};
  });
  prisma.job.count.mockResolvedValue(3);
  prisma.task.count.mockResolvedValue(1);
});

describe("GET /hub/v1/summary auth", () => {
  it("401 with an empty body when the Authorization header is missing", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(prisma.job.count).not.toHaveBeenCalled();
  });

  it("401 for an unknown token", async () => {
    const res = await get("jsync_nope");
    expect(res.status).toBe(401);
  });

  it("401 for an expired hub token", async () => {
    putToken("jsync_old", ["hub:read"], { expiresAt: new Date(Date.now() - 1000) });
    const res = await get("jsync_old");
    expect(res.status).toBe(401);
  });

  it("403 for a regular MCP token without hub:read or full", async () => {
    putToken("jsync_writer", ["jobs:write", "questions:write", "resume:write"]);
    const res = await get("jsync_writer");
    expect(res.status).toBe(403);
    expect(prisma.job.count).not.toHaveBeenCalled();
  });

  it("allows a full token", async () => {
    putToken("jsync_full", ["jobs:write", "questions:write", "resume:write", "full"]);
    const res = await get("jsync_full");
    expect(res.status).toBe(200);
  });

  it("401 once the token is revoked", async () => {
    const row = putToken("jsync_hub", ["hub:read"]);
    expect((await get("jsync_hub")).status).toBe(200);

    const revoked = await revokeMcpToken(row.id);
    expect(revoked.success).toBe(true);

    const res = await get("jsync_hub");
    expect(res.status).toBe(401);
  });
});

describe("GET /hub/v1/summary body", () => {
  it("returns a hub/1 summary that validates against the hub schema", async () => {
    putToken("jsync_hub", ["hub:read"]);
    prisma.job.count
      .mockResolvedValueOnce(12) // new today
      .mockResolvedValueOnce(80) // new 7d
      .mockResolvedValueOnce(2) // applied today
      .mockResolvedValueOnce(9) // applied 7d
      .mockResolvedValueOnce(70) // applied total
      .mockResolvedValueOnce(1) // interview
      .mockResolvedValueOnce(0); // offer
    prisma.task.count.mockResolvedValueOnce(4);

    const res = await get("jsync_hub");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const body = await res.json();
    const ok = validate(body);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);

    expect(body).toMatchObject({ protocol: "hub/1", service: "jobsync", status: "ok", title: "Поиск работы" });
    const values = Object.fromEntries(body.metrics.map((m: any) => [m.key, m.value]));
    expect(values).toEqual({
      new_today: 12,
      new_7d: 80,
      applied_today: 2,
      applied_7d: 9,
      applied_total: 70,
      interview: 1,
      offer: 0,
      tasks_today: 4,
    });
    expect(body.headline).toBe("Сегодня 12 новых, 2 откликов, 1 в интервью");
    expect(body.links).toEqual([{ label: "Открыть", url: "http://localhost:3737/dashboard/myjobs" }]);
  });

  it("only counts: no job rows are read", async () => {
    putToken("jsync_hub", ["hub:read"]);
    await get("jsync_hub");
    // Every query is a count scoped to the token owner.
    for (const [args] of prisma.job.count.mock.calls) expect(args.where.userId).toBe("user-1");
    for (const [args] of prisma.task.count.mock.calls) expect(args.where.userId).toBe("user-1");
  });

  it("answers 200 with status error when the database fails", async () => {
    putToken("jsync_hub", ["hub:read"]);
    prisma.job.count.mockRejectedValue(new Error("db down"));
    const res = await get("jsync_hub");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validate(body)).toBe(true);
    expect(body.status).toBe("error");
  });
});

describe("hub:read gets no MCP tools", () => {
  it("/api/mcp refuses a hub-only token with 403", async () => {
    putToken("jsync_hub", ["hub:read"]);
    const res = await mcpPost(
      new Request("http://localhost:3737/api/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer jsync_hub",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("createMcpToken hubOnly", () => {
  beforeEach(() => {
    prisma.mcpAccessToken.count.mockResolvedValue(0);
    prisma.mcpAccessToken.create.mockImplementation(async ({ data }: any) => ({
      id: "new",
      lastUsedAt: null,
      createdAt: new Date(),
      ...data,
    }));
  });

  it("issues a token with only hub:read and keeps the non-full expiry", async () => {
    const before = Date.now();
    const result = await createMcpToken({ name: "Admin hub", expiryDays: 365, hubOnly: true });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.record.scopes).toEqual(["hub:read"]);
    const days = (result.record.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(364);
  });

  it("refuses hubOnly together with full access", async () => {
    const result = await createMcpToken({ name: "x", expiryDays: 30, hubOnly: true, fullAccess: true });
    expect(result.success).toBe(false);
    expect(prisma.mcpAccessToken.create).not.toHaveBeenCalled();
  });
});

describe("startOfDayInTimeZone", () => {
  it("uses the owner's calendar day (Asia/Almaty, UTC+5)", () => {
    expect(startOfDayInTimeZone(new Date("2026-10-26T02:00:00Z"), "Asia/Almaty").toISOString()).toBe(
      "2026-10-25T19:00:00.000Z",
    );
    expect(startOfDayInTimeZone(new Date("2026-10-26T20:00:00Z"), "Asia/Almaty").toISOString()).toBe(
      "2026-10-26T19:00:00.000Z",
    );
  });

  it("uses midnight's offset on a DST day (Europe/Berlin, 2026-10-25)", () => {
    expect(startOfDayInTimeZone(new Date("2026-10-25T12:00:00Z"), "Europe/Berlin").toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
  });
});
