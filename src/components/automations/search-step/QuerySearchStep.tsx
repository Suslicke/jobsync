"use client";

import { TriangleAlert } from "lucide-react";
import { APP_CONSTANTS } from "@/lib/constants";
import { getAllJobLocations } from "@/actions/jobLocation.actions";
import { createLocation } from "@/actions/job.actions";
import { EntityStringChipInput } from "../ats-search-step/EntityStringChipInput";
import { TargetingFields } from "../ats-search-step/TargetingFields";
import { RunOptionsFields } from "../ats-search-step/RunOptionsFields";
import {
  asLocalOption,
  noStoredOptions,
} from "../ats-search-step/types";
import type { QuerySourceConfig } from "@/models/automation.model";

interface QuerySearchStepProps {
  value: QuerySourceConfig;
  onChange: (next: QuerySourceConfig) => void;
}

// A query board fetches one request per search term per geography, so both
// lists must have something in them before there is any work to do.
export function QuerySearchStep({ value, onChange }: QuerySearchStepProps) {
  const queries = value.queries ?? [];
  const geos = value.geos ?? [];
  const pairs = queries.length * geos.length;

  return (
    <div className="space-y-5">
      <EntityStringChipInput
        label="Search terms"
        placeholder="e.g., Senior Python Engineer"
        noun="search term"
        description="Sent to the board as the search query. One request per term per location."
        values={queries}
        onChange={(next) => onChange({ ...value, queries: next })}
        loadOptions={noStoredOptions}
        createOption={asLocalOption}
      />

      <EntityStringChipInput
        label="Search locations"
        placeholder="e.g., Canada"
        noun="location"
        description="Sent to the board as the geography. Not the same as the Locations filter below, which only hides results after the fetch."
        values={geos}
        onChange={(next) => onChange({ ...value, geos: next })}
        loadOptions={async () => {
          const res = await getAllJobLocations();
          return Array.isArray(res) ? res : [];
        }}
        createOption={async (lbl) => {
          const res = await createLocation(lbl);
          return res?.success ? res.data : null;
        }}
      />

      {pairs === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Add at least one search term and one location. Without both there is
            nothing to send to the board.
          </span>
        </div>
      ) : pairs > APP_CONSTANTS.QUERY_MAX_PAIRS ? (
        // Shown here rather than left to the save boundary: the cost is the
        // product of two fields, so a user filling in the second one has no way
        // to see it coming, and a hundred searches is three quarters of an hour
        // of paced fetching.
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {pairs} searches per run — each term is searched in each location.
            Keep it to {APP_CONSTANTS.QUERY_MAX_PAIRS}.
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {pairs} search{pairs === 1 ? "" : "es"} per run.
        </p>
      )}

      <TargetingFields value={value} onChange={onChange} />
      <RunOptionsFields value={value} onChange={onChange} />
    </div>
  );
}
