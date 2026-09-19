import { boardById } from "@/lib/scraper/boards";
import type { AnySourceConfig, JobBoard } from "@/models/automation.model";

// What this board was pointed at, in its own unit. The review screen and the
// detail page both need it, and "Companies: -" on a feed board reads as a
// misconfiguration rather than as the feed being the target.
export function describeSourceTargets(
  board: JobBoard,
  cfg: Partial<AnySourceConfig> | null | undefined,
): { label: string; value: string } {
  const raw = (cfg ?? {}) as Record<string, unknown>;
  const list = (key: string): string[] =>
    Array.isArray(raw[key]) ? (raw[key] as string[]) : [];

  switch (boardById(board)?.kind) {
    case "query": {
      const queries = list("queries");
      const geos = list("geos");
      return {
        label: "Searches",
        value:
          queries.length && geos.length
            ? `${queries.join(", ")} in ${geos.join(", ")}`
            : "-",
      };
    }
    case "channel": {
      const channels = list("channels");
      return { label: "Channels", value: channels.length ? channels.join(", ") : "-" };
    }
    case "feed": {
      const pages = typeof raw.maxPages === "number" ? raw.maxPages : null;
      const visa = raw.visaSponsorshipOnly === true ? ", visa-sponsoring only" : "";
      return {
        label: "Feed",
        value: `${boardById(board)?.label ?? board}${pages ? `, ${pages} page(s) per run` : ""}${visa}`,
      };
    }
    default: {
      const companies = Array.isArray(raw.companies)
        ? (raw.companies as { name: string }[])
        : [];
      return {
        label: "Companies",
        value: companies.length ? companies.map((c) => c.name).join(", ") : "-",
      };
    }
  }
}
