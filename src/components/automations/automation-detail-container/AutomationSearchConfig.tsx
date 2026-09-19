"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  AnySourceConfig,
  CompaniesSourceConfig,
  JobBoard,
} from "@/models/automation.model";
import { boardById } from "@/lib/scraper/boards";
import { companyBoardUrl } from "@/lib/atsBoardUrl";
import { APP_CONSTANTS } from "@/lib/constants";
import { describeSourceTargets } from "../search-step/summary";

// Pure JSON parse (no runner dependency — this is a client component, and
// runner.ts pulls the network-calling scraper into the client bundle). The raw
// parse may be missing any field, so it's a Partial of the config shape.
function parseBoardConfig(
  sourceConfig: string | null | undefined,
  jobBoard: JobBoard,
): Partial<AnySourceConfig> | null {
  if (!sourceConfig) return null;
  try {
    return JSON.parse(sourceConfig)?.[jobBoard] ?? null;
  } catch {
    return null;
  }
}

interface AutomationSearchConfigProps {
  sourceConfig: string | null | undefined;
  jobBoard: JobBoard;
  retired: boolean;
}

export function AutomationSearchConfig({
  sourceConfig,
  jobBoard,
  retired,
}: AutomationSearchConfigProps) {
  const [showSearchConfig, setShowSearchConfig] = useState(false);

  const config = retired ? null : parseBoardConfig(sourceConfig, jobBoard);

  if (!config) return null;

  // Company badges carry a link to each board; the other kinds have no
  // per-company page to link to, so they render their own unit as plain chips.
  const isCompanies = boardById(jobBoard)?.kind === "companies";
  const companies = isCompanies
    ? ((config as Partial<CompaniesSourceConfig>).companies ?? [])
    : [];
  const targets = describeSourceTargets(jobBoard, config);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="mt-4 -ml-2 text-muted-foreground"
        onClick={() => setShowSearchConfig((prev) => !prev)}
      >
        {showSearchConfig ? (
          <ChevronUp className="h-4 w-4 mr-1" />
        ) : (
          <ChevronDown className="h-4 w-4 mr-1" />
        )}
        {showSearchConfig ? "Show less" : "Show more"}
      </Button>

      {showSearchConfig && (
        <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2 md:col-span-4">
            <p className="text-sm text-muted-foreground">{targets.label}</p>
            {isCompanies ? (
              companies.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {companies.map((c) => (
                    <Badge key={c.token} variant="secondary" className="gap-1">
                      {c.name}
                      <a
                        href={companyBoardUrl(jobBoard, c)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${c.name} job board`}
                        title="Open job board"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="font-medium">-</p>
              )
            ) : (
              <p className="font-medium">{targets.value}</p>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Target titles</p>
            <p className="font-medium">
              {config.targetTitles?.length
                ? config.targetTitles.join(", ")
                : "Any"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Keywords</p>
            <p className="font-medium">
              {config.keywords?.length
                ? config.keywords.join(", ")
                : "None"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Locations</p>
            <p className="font-medium">
              {config.locations?.length
                ? `${config.locations.join(", ")}${
                    config.strictLocation ? " (strict)" : ""
                  }`
                : "Any location"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              Jobs analyzed per run
            </p>
            <p className="font-medium">
              {config.topK ?? APP_CONSTANTS.MAX_JOBS_PER_RUN}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Extra listings</p>
            <p className="font-medium">
              {config.saveUnanalyzed !== false
                ? "Saved"
                : "Not saved"}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
