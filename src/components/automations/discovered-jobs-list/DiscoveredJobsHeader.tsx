"use client";

import { CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArchiveX,
  ArrowDownWideNarrow,
  CalendarClock,
  Check,
  ListChecks,
  ListFilter,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DISCOVERY_STATUSES } from "@/lib/constants";
import { RecordsCount } from "@/components/RecordsCount";
import type {
  DiscoveredOnly,
  DiscoveredQuery,
  DiscoveredSortBy,
  DiscoveryStatus,
} from "@/models/automation.model";

// Sorting lives in the header rather than in a column, because what it changes
// is which rows get loaded at all, not how the loaded ones are arranged.
const SORT_LABELS: Record<DiscoveredSortBy, string> = {
  matchScore: "AI match",
  reach: "Reachability",
  discoveredAt: "Newest first",
};

// How long ago a job was first seen. 0 is "any time"; the server reads a
// missing age the same way.
const AGE_LABELS: [days: number, label: string][] = [
  [0, "Any time"],
  [1, "Last 24 hours"],
  [3, "Last 3 days"],
  [7, "Last 7 days"],
  [30, "Last 30 days"],
];
const DISMISS_AGES = [7, 14, 30, 60];
const ONLY_LABELS: Record<DiscoveredOnly, string> = {
  remote: "Remote",
  clear: "No blockers",
  scored: "AI-scored",
  visa: "Visa sponsorship",
};

interface DiscoveredJobsHeaderProps {
  loadedCount: number;
  totalJobs: number;
  showClear: boolean;
  onClear: () => void;
  query: DiscoveredQuery;
  onQueryChange: (patch: Partial<DiscoveredQuery>) => void;
  /** Unreviewed jobs in the whole automation; nothing to dismiss without any. */
  newCount: number;
  onDismissOlderThan: (days: number) => void;
  /** The combined list only: the automations it can be narrowed to. */
  automations?: { id: string; name: string }[];
  /** Rows ticked in the table; the bulk buttons appear with the first one. */
  selectedCount: number;
  onBulkStatus: (status: "accepted" | "dismissed") => void;
}

export function DiscoveredJobsHeader({
  loadedCount,
  totalJobs,
  showClear,
  onClear,
  query,
  onQueryChange,
  newCount,
  onDismissOlderThan,
  automations,
  selectedCount,
  onBulkStatus,
}: DiscoveredJobsHeaderProps) {
  const { statusFilter, sortBy, maxAgeDays, only } = query;
  const toggleStatusFilter = (status: DiscoveryStatus, checked: boolean) => {
    onQueryChange({
      statusFilter: checked
        ? [...statusFilter, status]
        : statusFilter.filter((s) => s !== status),
    });
  };
  const toggleOnly = (key: DiscoveredOnly, checked: boolean) => {
    onQueryChange({
      only: checked ? [...only, key] : only.filter((k) => k !== key),
    });
  };

  return (
    <CardHeader>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>Discovered Jobs</CardTitle>
          {totalJobs > 0 && (
            <RecordsCount count={loadedCount} total={totalJobs} label="jobs" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedCount > 0 && (
            <>
              <Button size="sm" onClick={() => onBulkStatus("accepted")}>
                <Check className="h-4 w-4 mr-1.5" />
                Accept {selectedCount}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onBulkStatus("dismissed")}
              >
                <X className="h-4 w-4 mr-1.5" />
                Dismiss {selectedCount}
              </Button>
            </>
          )}
          {showClear && (
            <Button variant="outline" size="sm" onClick={onClear}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              Clear
            </Button>
          )}
          {newCount > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ArchiveX className="h-4 w-4 mr-1.5" />
                  Dismiss old
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  Dismiss new jobs older than
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {DISMISS_AGES.map((days) => (
                  <DropdownMenuItem
                    key={days}
                    onSelect={() => onDismissOlderThan(days)}
                  >
                    {days} days
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {automations && automations.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Workflow className="h-4 w-4 mr-1.5" />
                  {automations.find((a) => a.id === query.automationId)?.name ??
                    "All automations"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Found by</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={query.automationId ?? ""}
                  onValueChange={(v) =>
                    onQueryChange({ automationId: v || undefined })
                  }
                >
                  <DropdownMenuRadioItem value="">
                    All automations
                  </DropdownMenuRadioItem>
                  {automations.map((a) => (
                    <DropdownMenuRadioItem key={a.id} value={a.id}>
                      {a.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ListChecks className="h-4 w-4 mr-1.5" />
                {only.length ? `Only · ${only.length}` : "Only"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show only</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(Object.keys(ONLY_LABELS) as DiscoveredOnly[]).map((key) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={only.includes(key)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(checked) => toggleOnly(key, checked)}
                >
                  {ONLY_LABELS[key]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <CalendarClock className="h-4 w-4 mr-1.5" />
                {AGE_LABELS.find(([days]) => days === maxAgeDays)?.[1] ??
                  "Any time"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Discovered</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={String(maxAgeDays)}
                onValueChange={(v) => onQueryChange({ maxAgeDays: Number(v) })}
              >
                {AGE_LABELS.map(([days, label]) => (
                  <DropdownMenuRadioItem key={days} value={String(days)}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowDownWideNarrow className="h-4 w-4 mr-1.5" />
                {SORT_LABELS[sortBy]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={sortBy}
                onValueChange={(v) =>
                  onQueryChange({ sortBy: v as DiscoveredSortBy })
                }
              >
                {(Object.keys(SORT_LABELS) as DiscoveredSortBy[]).map(
                  (value) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {SORT_LABELS[value]}
                    </DropdownMenuRadioItem>
                  ),
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ListFilter className="h-4 w-4 mr-1.5" />
                Status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {DISCOVERY_STATUSES.map((status) => (
                <DropdownMenuCheckboxItem
                  key={status.value}
                  checked={statusFilter.includes(status.value)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(checked) =>
                    toggleStatusFilter(status.value, checked)
                  }
                >
                  {status.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </CardHeader>
  );
}
