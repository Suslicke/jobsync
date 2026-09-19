"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { boardsOfKind } from "@/lib/scraper/boards";
import type { JobBoard } from "@/models/automation.model";

// Only companies boards are browsable here: a feed or a query board has no
// company directory to scope to.
const COMPANY_BOARDS = boardsOfKind("companies").map((b) => b.id);

export type CompanyScope = "mine" | "watchlist" | `board:${JobBoard}`;

const SCOPES: CompanyScope[] = [
  "mine",
  "watchlist",
  ...COMPANY_BOARDS.map((id): CompanyScope => `board:${id}`),
];

export function boardProvider(scope: CompanyScope): JobBoard | null {
  return scope.startsWith("board:")
    ? (scope.slice("board:".length) as JobBoard)
    : null;
}

// Owns ?scope= directly rather than hoisting it into AdminTabsContainer,
// which is shared by all six tabs. Safe to have two writers on one query
// string: each only sets its own key and rebuilds from the current params.
export function useCompanyScope() {
  const router = useRouter();
  const pathname = usePathname();
  const queryParams = useSearchParams();

  const raw = queryParams.get("scope") as CompanyScope | null;
  const scope: CompanyScope = raw && SCOPES.includes(raw) ? raw : "mine";

  const setScope = useCallback(
    (next: CompanyScope) => {
      const params = new URLSearchParams(queryParams.toString());
      params.set("scope", next);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, queryParams, router],
  );

  return { scope, setScope };
}
