import type { CompaniesSourceConfig } from "@/models/automation.model";

// The company picker edits the companies-kind config; the extra per-company
// `host` is Lever-only and UI-invisible everywhere else.
export type AtsConfigValue = CompaniesSourceConfig;

export type EntityOption = { id: string; label: string; value: string };

// Chip inputs for queries, geographies and channels have no entity table
// behind them — the value IS the string. This keeps EntityStringChipInput's
// contract without inventing DB rows nobody asked for.
export const noStoredOptions = async (): Promise<EntityOption[]> => [];
export const asLocalOption = async (label: string): Promise<EntityOption> => ({
  id: label,
  label,
  value: label.toLowerCase(),
});
