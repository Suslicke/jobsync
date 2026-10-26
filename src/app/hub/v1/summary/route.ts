import { canReadHubSummary, resolveMcpToken } from "@/lib/mcp/auth";
import { buildHubSummary, HUB_TITLE, HUB_TITLE_RU } from "@/lib/hub/summary";

// Admin hub, protocol v1: GET /hub/v1/summary with an MCP access token that
// carries `hub:read` (or `full`). Counts only, see lib/hub/summary.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request): Promise<Response> {
  const auth = await resolveMcpToken(req);
  if (!auth.ok) {
    return new Response(null, { status: 401, headers: NO_STORE });
  }
  if (!canReadHubSummary(auth.scopes)) {
    return new Response(null, { status: 403, headers: NO_STORE });
  }

  const appUrl = process.env.NEXTAUTH_URL || new URL(req.url).origin;
  try {
    const summary = await buildHubSummary(auth.userId, { appUrl });
    return Response.json(summary, { headers: NO_STORE });
  } catch {
    // Service up, data unreadable: the protocol wants 200 with status "error".
    return Response.json(
      {
        protocol: "hub/1",
        service: "jobsync",
        generated_at: new Date().toISOString(),
        status: "error",
        title: HUB_TITLE,
        headline: "Could not compute the summary",
        l10n: { ru: { title: HUB_TITLE_RU, headline: "Не удалось посчитать сводку" } },
      },
      { headers: NO_STORE },
    );
  }
}
