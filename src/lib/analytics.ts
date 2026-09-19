// Campaign analytics: what was collected, what was decided, and when.
//
// Everything here is pure, because the two mistakes this replaces are both
// arithmetic. The first is the day boundary: the old panel bucketed by the
// recording machine's zone, that machine ran on +05, and fourteen applications
// made on the evening of 31 August collapsed into a single September day while
// 31 August vanished from the chart entirely. The instant is the truth, the day
// is recomputed on read, and the zone is always passed in — never taken from
// whatever zone the server happens to run in.
//
// The second is counting rows where roles were meant. One opening is published
// under several ids, on several boards, in several countries; counting the rows
// makes a campaign look twice its size.

/**
 * How precisely the moment of a decision is known.
 *
 * `exact` was recorded as it happened; `minute` was recovered from a run log's
 * filename and is one instant shared by every job in that run; `day` has no
 * time at all. Null means nobody recorded a precision, which is not the same as
 * `exact` and is never printed as one.
 */
export const TIME_PRECISIONS = ["exact", "minute", "day"] as const;

export type TimePrecision = (typeof TIME_PRECISIONS)[number];

export const isTimePrecision = (value: unknown): value is TimePrecision =>
  typeof value === "string" && (TIME_PRECISIONS as readonly string[]).includes(value);

/** The row a missing label gets. It is named, counted and shown, never folded away. */
export const NOT_STATED = "Not stated";

// --- unique roles ----------------------------------------------------------

// roleKey lives in lib/jobs/roleKey.ts: the scraper's dedup needs it too, and a
// second copy of that normalisation is exactly the serve.mjs-vs-state.mjs
// divergence the old panel paid for. Re-exported here so collapseRoles and
// every analytics caller keep importing it from the same place.
import { roleKey } from "@/lib/jobs/roleKey";
export { roleKey };

// --- days ------------------------------------------------------------------

/**
 * The calendar day an instant falls on in `timeZone`, as `yyyy-mm-dd` so it
 * sorts as a string.
 */
export function dayKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const addDay = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

export interface DatedDecision {
  at: Date | null;
  precision?: TimePrecision | null;
}

export interface DayBuckets {
  days: { date: string; count: number }[];
  /** Decisions with no recorded instant. Reported, never counted as a zero day. */
  undated: number;
}

/**
 * Decisions per calendar day, with the empty days inside the range filled in.
 * A gap in the series reads as lost data rather than as a day nothing happened.
 *
 * A `day`-precision instant is bucketed by its UTC date and is not converted:
 * it never had a time to convert, and the importer parks it at midday UTC so
 * that no offset can carry it into a neighbouring day. Converting it would
 * invent a time and then move the date with it.
 */
export function applicationsByDay(rows: DatedDecision[], timeZone: string): DayBuckets {
  const counts = new Map<string, number>();
  let undated = 0;
  for (const row of rows) {
    if (!row.at || Number.isNaN(row.at.getTime())) {
      undated++;
      continue;
    }
    const day = dayKey(row.at, row.precision === "day" ? "UTC" : timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const sorted = [...counts.keys()].sort();
  const days: { date: string; count: number }[] = [];
  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    for (let day = sorted[0]; day <= last; day = addDay(day)) {
      days.push({ date: day, count: counts.get(day) ?? 0 });
    }
  }
  return { days, undated };
}

// Spelled out here rather than taken from Intl's "short" month: that name
// changes with the ICU build (Node 20 writes "Sep", Node 22 writes "Sept"),
// and a date that reads differently on the server than in the browser is the
// same class of bug as the day boundary itself.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `dd Mon yyyy` for a day already resolved in the reader's zone. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/**
 * A decision's moment, written no more precisely than it is known. A time
 * recovered from a run log's filename is shared by every job in that run, and a
 * day-precision date has no time at all — printing either as "22:25" would
 * claim a measurement nobody made.
 */
export function formatDecisionTime(
  at: Date | null,
  precision: TimePrecision | null | undefined,
  timeZone: string,
): string {
  if (!at || Number.isNaN(at.getTime())) return "date not recorded";
  // A day-precision instant carries no zone information either, so it is read
  // back in the zone it was written in.
  const date = formatDay(dayKey(at, precision === "day" ? "UTC" : timeZone));
  if (precision === "day") return date;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return `${date}, ${time}`;
}

// --- funnels ---------------------------------------------------------------

export interface FunnelStep {
  label: string;
  count: number;
  note?: string;
}

export interface FunnelRow extends FunnelStep {
  /** Share of the previous step that reached this one; null for the first step
   *  and whenever the previous step is empty, because a ratio of nothing is not
   *  a measurement. */
  keptPct: number | null;
  /** Share of the first step, for the bar width. */
  widthPct: number;
}

/**
 * Each step is measured on the previous step's output, so the funnel can only
 * narrow. The old panel once computed every step independently over the whole
 * pool and drew a funnel that widened in the middle.
 */
export function funnelRows(steps: FunnelStep[]): FunnelRow[] {
  const first = steps[0]?.count ?? 0;
  return steps.map((step, i) => {
    const prev = i === 0 ? null : steps[i - 1].count;
    return {
      ...step,
      keptPct: prev ? Math.round((step.count / prev) * 100) : null,
      widthPct: first ? Math.round((step.count / first) * 100) : 0,
    };
  });
}

export const RESPONSE_STAGES = ["Applied", "Interview", "Offer", "Accepted"] as const;

// How far a role got with the employer, read off the status it carries now.
// A role counts for every stage up to the furthest one it reached, so the
// funnel nests by construction: an offer is also an interview that happened.
//
// JobSync overwrites `statusId` in place and keeps no transition log, so a role
// rejected after an interview reads as stage 0 here. That is a floor, not a
// measurement, and it is why a rejection sets no stage at all — it is counted
// beside the funnel instead of inside it.
const STAGE_BY_STATUS: Record<string, number> = {
  applied: 0,
  interview: 1,
  offer: 2,
  "offer-declined": 2,
  "offer-accepted": 3,
};

export function stageReached(statuses: (string | null | undefined)[]): number {
  let stage = 0;
  for (const status of statuses) {
    const value = STAGE_BY_STATUS[String(status ?? "").toLowerCase()];
    if (value !== undefined && value > stage) stage = value;
  }
  return stage;
}

// --- roles ------------------------------------------------------------------

/** One saved posting, as the analytics read hands it over. */
export interface PostingRow {
  company: string | null | undefined;
  title: string | null | undefined;
  applied: boolean;
  /** True when the user recorded a decision about it, applied or passed. */
  decided: boolean;
  status: string | null | undefined;
  appliedAt: Date | null;
  appliedPrecision: TimePrecision | null;
  source: string | null | undefined;
  location: string | null | undefined;
}

/** One opening, however many times it was published. */
export interface RoleRow {
  key: string;
  /** How many saved postings collapsed into this role. */
  postings: number;
  applied: boolean;
  decided: boolean;
  appliedAt: Date | null;
  appliedPrecision: TimePrecision | null;
  /** How far it got with the employer; see stageReached. */
  stage: number;
  rejected: boolean;
  source: string | null;
  location: string | null;
}

/**
 * Postings collapsed into the openings behind them. Counting rows makes a
 * campaign look larger than it was: Grafana Labs publishes one opening as four
 * country cards, and a LinkedIn posting is usually on the employer's board too.
 *
 * The earliest application wins, because the question the day chart answers is
 * when the user first wrote to this employer about this role.
 *
 * A date is read only off a posting that still says it was applied to. Taking
 * an application back leaves the old `appliedDate` sitting on the row — no path
 * in the app clears it — and the old panel learned the same lesson from its
 * journal: a cancelled application stays in the history and counts in nothing.
 */
export function collapseRoles(postings: PostingRow[]): RoleRow[] {
  const byKey = new Map<string, RoleRow & { statuses: string[] }>();
  for (const p of postings) {
    const key = roleKey(p.company, p.title);
    let role = byKey.get(key);
    if (!role) {
      role = {
        key,
        postings: 0,
        applied: false,
        decided: false,
        appliedAt: null,
        appliedPrecision: null,
        stage: 0,
        rejected: false,
        source: null,
        location: null,
        statuses: [],
      };
      byKey.set(key, role);
    }
    role.postings++;
    role.applied ||= p.applied;
    role.decided ||= p.decided || p.applied;
    if (p.status) role.statuses.push(p.status);
    if (p.applied && p.appliedAt && (!role.appliedAt || p.appliedAt < role.appliedAt)) {
      role.appliedAt = p.appliedAt;
      role.appliedPrecision = p.appliedPrecision;
    }
    // The first posting that states one. A role published on four boards is
    // labelled by whichever of them said where it is.
    if (!role.source && p.source) role.source = p.source;
    if (!role.location && p.location) role.location = p.location;
  }
  return [...byKey.values()].map(({ statuses, ...role }) => {
    // A status past "applied" is itself proof of an application: only some of
    // the paths that record one also set the flag.
    const applied = role.applied || stageReached(statuses) > 0;
    return {
      ...role,
      stage: stageReached(statuses),
      rejected: statuses.some((s) => s.toLowerCase() === "rejected"),
      applied,
      // An application is a decision, and this repair has to happen beside the
      // one above or the two disagree: a role dragged straight to Offer in the
      // dropdown sets neither the flag nor a feedback row, so it counted as
      // applied but not decided — and the collection funnel, which exists to
      // narrow, widened at that step.
      decided: role.decided || applied,
    };
  });
}

// --- ranked labels ---------------------------------------------------------

export interface LabelCount {
  label: string;
  collected: number;
  applied: number;
}

export interface LabelBreakdown {
  rows: LabelCount[];
  /** Everything past the top N, summed, with how many distinct labels it hides. */
  other: LabelCount & { labels: number };
  /** Roles that state no label at all. */
  notStated: LabelCount;
}

/**
 * Sources and locations ranked by the number of roles carrying them, with the
 * unlabelled roles kept as their own named row.
 *
 * Deliberately the raw label and not a derived country. Measured over the pool
 * this migration feeds on, a country classifier resolved 78% of labels — but
 * "resolved" counted regex hits, and Waterloo/Belgium, Ontario/California and
 * Vancouver/WA all resolved to Canada, the one bucket the campaign aims at.
 * A map is worse still: an unpainted country and a zero-count country are the
 * same pixels, so the 22% it cannot place would read as "no jobs there".
 */
export function rankLabels(
  rows: { label: string | null | undefined; applied: boolean }[],
  topN: number,
): LabelBreakdown {
  const byLabel = new Map<string, LabelCount>();
  const notStated: LabelCount = { label: NOT_STATED, collected: 0, applied: 0 };
  for (const row of rows) {
    const label = String(row.label ?? "").trim();
    const bucket = label
      ? byLabel.get(label) ?? { label, collected: 0, applied: 0 }
      : notStated;
    bucket.collected++;
    if (row.applied) bucket.applied++;
    if (label) byLabel.set(label, bucket);
  }
  const ranked = [...byLabel.values()].sort(
    (a, b) => b.collected - a.collected || b.applied - a.applied || a.label.localeCompare(b.label),
  );
  const tail = ranked.slice(topN);
  return {
    rows: ranked.slice(0, topN),
    other: {
      label: "Other labels",
      labels: tail.length,
      collected: tail.reduce((n, r) => n + r.collected, 0),
      applied: tail.reduce((n, r) => n + r.applied, 0),
    },
    notStated,
  };
}
