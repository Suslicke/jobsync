import prisma from "@/lib/db";
import { APP_CONSTANTS } from "@/lib/constants";

/**
 * Hub protocol v1 summary (admin hub, GET /hub/v1/summary). Counts only: no
 * company, title or contact names leave the app through this object.
 */
export type HubSummary = {
  protocol: "hub/1";
  service: string;
  generated_at: string;
  status: "ok" | "warn" | "error";
  title: string;
  headline?: string;
  metrics?: {
    key?: string;
    label: string;
    value: number;
    unit?: string;
    goal?: number;
    trend?: "up" | "down" | "flat";
    period?: string;
  }[];
  links?: { label: string; url: string }[];
  ttl_seconds?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_TASK_STATUSES = ["in-progress", "needs-attention"];

/** Milliseconds `timeZone` is ahead of UTC at `at`. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the calendar day containing `now` starts in `timeZone`. */
export function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const local = new Date(now.getTime() + tzOffsetMs(now, timeZone));
  const midnightAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  // Two passes so a DST change between midnight and now uses midnight's offset.
  let start = midnightAsUtc - tzOffsetMs(new Date(midnightAsUtc), timeZone);
  start = midnightAsUtc - tzOffsetMs(new Date(start), timeZone);
  return new Date(start);
}

export function hubTimeZone(): string {
  const tz = process.env.HUB_TZ?.trim() || APP_CONSTANTS.HUB_DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return APP_CONSTANTS.HUB_DEFAULT_TIME_ZONE;
  }
}

export async function buildHubSummary(
  userId: string,
  opts: { now?: Date; timeZone?: string; appUrl?: string } = {},
): Promise<HubSummary> {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? hubTimeZone();
  const dayStart = startOfDayInTimeZone(now, timeZone);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const weekStart = new Date(dayStart.getTime() - 6 * DAY_MS);

  // Dismissed discovered jobs are kept only for dedup; the app never lists them.
  const visible = {
    userId,
    OR: [{ discoveryStatus: null }, { discoveryStatus: { not: "dismissed" } }],
  };

  const [
    newToday,
    new7d,
    appliedToday,
    applied7d,
    appliedTotal,
    interview,
    offer,
    tasksToday,
  ] = await Promise.all([
    prisma.job.count({ where: { ...visible, createdAt: { gte: dayStart } } }),
    prisma.job.count({ where: { ...visible, createdAt: { gte: weekStart } } }),
    prisma.job.count({ where: { ...visible, appliedDate: { gte: dayStart, lt: dayEnd } } }),
    prisma.job.count({ where: { ...visible, appliedDate: { gte: weekStart, lt: dayEnd } } }),
    prisma.job.count({ where: { ...visible, applied: true } }),
    prisma.job.count({ where: { ...visible, Status: { value: "interview" } } }),
    prisma.job.count({ where: { ...visible, Status: { value: "offer" } } }),
    prisma.task.count({
      where: {
        userId,
        status: { in: OPEN_TASK_STATUSES },
        dueDate: { gte: dayStart, lt: dayEnd },
      },
    }),
  ]);

  const headlineParts = [`сегодня ${newToday} новых`, `${appliedToday} откликов`];
  if (interview > 0) headlineParts.push(`${interview} в интервью`);
  if (offer > 0) headlineParts.push(`${offer} офферов`);
  const headline = headlineParts.join(", ");

  const summary: HubSummary = {
    protocol: "hub/1",
    service: "jobsync",
    generated_at: now.toISOString(),
    status: "ok",
    title: "Поиск работы",
    headline: headline.charAt(0).toUpperCase() + headline.slice(1),
    metrics: [
      { key: "new_today", label: "Новых вакансий", value: newToday, period: "today" },
      { key: "new_7d", label: "Новых за неделю", value: new7d, period: "7d" },
      { key: "applied_today", label: "Откликов", value: appliedToday, period: "today" },
      { key: "applied_7d", label: "Откликов за неделю", value: applied7d, period: "7d" },
      { key: "applied_total", label: "Откликов всего", value: appliedTotal },
      { key: "interview", label: "Интервью", value: interview },
      { key: "offer", label: "Офферов", value: offer },
      { key: "tasks_today", label: "Задач на сегодня", value: tasksToday, period: "today" },
    ],
    ttl_seconds: 900,
  };

  const link = appLink(opts.appUrl, "/dashboard/myjobs");
  if (link) summary.links = [{ label: "Открыть", url: link }];
  return summary;
}

function appLink(base: string | undefined, path: string): string | undefined {
  if (!base) return undefined;
  try {
    const url = new URL(path, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
