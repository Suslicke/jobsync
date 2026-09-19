"use client";

import { boardById } from "@/lib/scraper/boards";
import type {
  AnySourceConfig,
  ChannelSourceConfig,
  CompaniesSourceConfig,
  FeedSourceConfig,
  JobBoard,
  QuerySourceConfig,
} from "@/models/automation.model";
import { AtsSearchStep } from "./AtsSearchStep";
import { QuerySearchStep } from "./search-step/QuerySearchStep";
import { FeedSearchStep } from "./search-step/FeedSearchStep";
import { ChannelSearchStep } from "./search-step/ChannelSearchStep";

interface SearchStepProps {
  board: JobBoard;
  value: AnySourceConfig;
  onChange: (next: AnySourceConfig) => void;
}

// Step 1 of the wizard, dispatched on the board's kind — the one place the
// wizard cares which kind it is editing. Everything downstream (targeting, run
// options, review) is the same for all four.
export function SearchStep({ board, value, onChange }: SearchStepProps) {
  switch (boardById(board)?.kind) {
    case "query":
      return (
        <QuerySearchStep value={value as QuerySourceConfig} onChange={onChange} />
      );
    case "feed":
      return (
        <FeedSearchStep
          board={board}
          value={value as FeedSourceConfig}
          onChange={onChange}
        />
      );
    case "channel":
      return (
        <ChannelSearchStep
          value={value as ChannelSourceConfig}
          onChange={onChange}
        />
      );
    default:
      return (
        <AtsSearchStep
          provider={board}
          value={value as CompaniesSourceConfig}
          onChange={onChange}
        />
      );
  }
}
