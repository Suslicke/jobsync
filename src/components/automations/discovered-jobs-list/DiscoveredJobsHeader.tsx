"use client";

import { CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDownWideNarrow, ListFilter, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DISCOVERY_STATUSES } from "@/lib/constants";
import { RecordsCount } from "@/components/RecordsCount";
import type { DiscoveredSortBy, DiscoveryStatus } from "@/models/automation.model";

// Sorting lives in the header rather than in a column, because what it changes
// is which rows get loaded at all, not how the loaded ones are arranged.
const SORT_LABELS: Record<DiscoveredSortBy, string> = {
  matchScore: "AI match",
  reach: "Reachability",
  discoveredAt: "Newest first",
};

interface DiscoveredJobsHeaderProps {
  loadedCount: number;
  totalJobs: number;
  showClear: boolean;
  onClear: () => void;
  statusFilter: DiscoveryStatus[];
  onStatusFilterChange: (filter: DiscoveryStatus[]) => void;
  sortBy: DiscoveredSortBy;
  onSortByChange: (sortBy: DiscoveredSortBy) => void;
}

export function DiscoveredJobsHeader({
  loadedCount,
  totalJobs,
  showClear,
  onClear,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortByChange,
}: DiscoveredJobsHeaderProps) {
  const toggleStatusFilter = (status: DiscoveryStatus, checked: boolean) => {
    onStatusFilterChange(
      checked
        ? [...statusFilter, status]
        : statusFilter.filter((s) => s !== status),
    );
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
          {showClear && (
            <Button variant="outline" size="sm" onClick={onClear}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              Clear
            </Button>
          )}
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
                onValueChange={(v) => onSortByChange(v as DiscoveredSortBy)}
              >
                {(Object.keys(SORT_LABELS) as DiscoveredSortBy[]).map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {SORT_LABELS[value]}
                  </DropdownMenuRadioItem>
                ))}
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
