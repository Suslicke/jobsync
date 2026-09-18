// Why a job was applied to or passed over.
//
// Two vocabularies, deliberately different. "What worries you" on an
// application is a reservation — you applied anyway. A pass reason is a
// boundary you did not cross. Merging them would blur the only signal that
// says where the line is.

export type FeedbackKind = "applied" | "passed" | "rejected";

export const APPLY_METHODS = [
  "site form",
  "Easy Apply",
  "email",
  "via recruiter",
  "Telegram",
] as const;

export const LIKED_REASONS = [
  "stack",
  "remote",
  "salary",
  "product",
  "team",
  "visa / B2B",
  "seniority",
] as const;

export const WORRY_REASONS = [
  "wrong stack",
  "no visa",
  "time zone",
  "pay below target",
  "unknown company",
  "below my level",
  "office / hybrid",
] as const;

export const PASS_REASONS = [
  "wrong stack",
  "no visa sponsorship",
  "pay too low",
  "on-site required",
  "time zone",
  "below my level",
  "above my level",
  "unknown company",
  "domain not interesting",
  "too big a company",
  "posting looks stale",
  "already applied elsewhere",
] as const;

export interface JobFeedbackRecord {
  id: string;
  jobId: string;
  kind: FeedbackKind;
  how: string | null;
  liked: string[];
  disliked: string[];
  note: string | null;
  createdAt: Date;
}
