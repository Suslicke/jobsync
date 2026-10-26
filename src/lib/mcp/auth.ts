import prisma from "@/lib/db";
import { hashToken } from "./tokens";
import { APP_CONSTANTS } from "@/lib/constants";

type AuthSuccess = { ok: true; userId: string; scopes: string[]; tokenName: string };
type AuthFailure = { ok: false; status: 401 | 403; error: string };

export async function resolveMcpToken(req: Request): Promise<AuthSuccess | AuthFailure> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or malformed Authorization header" };
  }

  const plaintext = authHeader.slice("Bearer ".length).trim();
  if (!plaintext) {
    return { ok: false, status: 401, error: "Empty token" };
  }

  const tokenHash = hashToken(plaintext);
  const record = await prisma.mcpAccessToken.findUnique({ where: { tokenHash } });

  if (!record) {
    return { ok: false, status: 401, error: "Invalid token" };
  }

  if (record.expiresAt < new Date()) {
    return { ok: false, status: 401, error: "Token expired" };
  }

  // Fire-and-forget lastUsedAt update
  prisma.mcpAccessToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  let scopes: string[];
  try {
    scopes = JSON.parse(record.scopes) as string[];
  } catch {
    return { ok: false, status: 401, error: "Malformed token scopes" };
  }
  return { ok: true, userId: record.userId, scopes, tokenName: record.name };
}

/** True when every scope is `hub:read`: such a token may read the hub summary and nothing else. */
export function isHubOnlyToken(scopes: string[]): boolean {
  return scopes.length > 0 && scopes.every((s) => s === APP_CONSTANTS.MCP_HUB_READ_SCOPE);
}

/** May this token read GET /hub/v1/summary? `hub:read` or `full`. */
export function canReadHubSummary(scopes: string[]): boolean {
  return (
    scopes.includes(APP_CONSTANTS.MCP_HUB_READ_SCOPE) ||
    scopes.includes(APP_CONSTANTS.MCP_FULL_SCOPE)
  );
}
