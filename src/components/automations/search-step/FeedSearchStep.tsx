"use client";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { APP_CONSTANTS } from "@/lib/constants";
import { boardById } from "@/lib/scraper/boards";
import { TargetingFields } from "../ats-search-step/TargetingFields";
import { RunOptionsFields } from "../ats-search-step/RunOptionsFields";
import type { FeedSourceConfig, JobBoard } from "@/models/automation.model";

interface FeedSearchStepProps {
  board: JobBoard;
  value: FeedSourceConfig;
  onChange: (next: FeedSourceConfig) => void;
}

// A feed has no targets to pick: the feed is the target. What is left to
// choose is how deep to read it, and — on the one board where the parameter
// actually works — whether to read only the sponsored half.
export function FeedSearchStep({ board, value, onChange }: FeedSearchStepProps) {
  const meta = boardById(board);
  const maxPages = value.maxPages ?? APP_CONSTANTS.HIMALAYAS_MAX_PAGES;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Pages to read per run: {maxPages}</Label>
        <Slider
          min={1}
          max={APP_CONSTANTS.JOBSPRESSO_MAX_PAGES}
          step={1}
          value={[maxPages]}
          onValueChange={(next) => onChange({ ...value, maxPages: next[0] })}
        />
        <p className="text-sm text-muted-foreground">
          The {meta?.label ?? "feed"} is read newest-first, so this is how far
          back each run goes. Deeper runs take longer and are politer to read
          slowly.
        </p>
      </div>

      {/* Rendered only where the board table says the parameter exists.
          Arbeitnow's visa_sponsorship=true is the only server-side sponsorship
          filter in this pool; the same toggle on any other feed would be a
          control that silently changes nothing. */}
      {meta?.visaFilter && (
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <Label>Only visa-sponsoring roles</Label>
            <p className="text-sm text-muted-foreground">
              When on, only listings the board itself flags as offering
              sponsorship are fetched.
            </p>
          </div>
          <Switch
            checked={!!value.visaSponsorshipOnly}
            onCheckedChange={(checked) =>
              onChange({ ...value, visaSponsorshipOnly: checked })
            }
          />
        </div>
      )}

      <TargetingFields value={value} onChange={onChange} />
      <RunOptionsFields value={value} onChange={onChange} />
    </div>
  );
}
