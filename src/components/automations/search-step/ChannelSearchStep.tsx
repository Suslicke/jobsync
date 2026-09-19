"use client";

import { EntityStringChipInput } from "../ats-search-step/EntityStringChipInput";
import { TargetingFields } from "../ats-search-step/TargetingFields";
import { RunOptionsFields } from "../ats-search-step/RunOptionsFields";
import { asLocalOption, noStoredOptions } from "../ats-search-step/types";
import type { ChannelSourceConfig } from "@/models/automation.model";

interface ChannelSearchStepProps {
  value: ChannelSourceConfig;
  onChange: (next: ChannelSourceConfig) => void;
}

export function ChannelSearchStep({ value, onChange }: ChannelSearchStepProps) {
  return (
    <div className="space-y-5">
      <EntityStringChipInput
        label="Channels"
        placeholder="e.g., job_python"
        noun="channel"
        description="Public channel names, without the @ or the t.me/ prefix."
        values={value.channels ?? []}
        onChange={(next) => onChange({ ...value, channels: next })}
        loadOptions={noStoredOptions}
        createOption={asLocalOption}
      />
      <TargetingFields value={value} onChange={onChange} />
      <RunOptionsFields value={value} onChange={onChange} />
    </div>
  );
}
