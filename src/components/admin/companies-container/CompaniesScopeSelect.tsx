"use client";

import { useCallback, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAtsCompanyCount } from "@/actions/atsCompany.actions";
import { boardsOfKind } from "@/lib/scraper/boards";
import type { CompanyScope } from "./useCompanyScope";

// Only companies boards have a company directory to browse.
const COMPANY_BOARDS = boardsOfKind("companies");

type Props = {
  scope: CompanyScope;
  onScopeChange: (next: CompanyScope) => void;
};

export function CompaniesScopeSelect({ scope, onScopeChange }: Props) {
  // Counts are decoration; fetched on first open so a visit that never
  // touches Browse pays no round-trips.
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open || counts) return;
      Promise.all(COMPANY_BOARDS.map((b) => getAtsCompanyCount(b.id)))
        .then((totals) =>
          setCounts(
            Object.fromEntries(COMPANY_BOARDS.map((b, i) => [b.id, totals[i]])),
          ),
        )
        .catch(() => {});
    },
    [counts],
  );

  return (
    <Select
      value={scope}
      onValueChange={(v) => onScopeChange(v as CompanyScope)}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger aria-label="Select company scope" className="h-8 w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Library</SelectLabel>
          <SelectItem value="mine">My Companies</SelectItem>
          <SelectItem value="watchlist">Watchlist</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Browse boards</SelectLabel>
          {COMPANY_BOARDS.map((board) => (
            <SelectItem key={board.id} value={`board:${board.id}`}>
              {board.label}
              {counts?.[board.id] !== undefined && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {counts[board.id].toLocaleString()}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
