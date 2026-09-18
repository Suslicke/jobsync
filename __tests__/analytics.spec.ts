// Each case below is a wrong number the old panel printed at least once:
// fourteen applications on one day because the machine ran on +05, a campaign
// that looked twice its size because one opening was published four times, a
// backfilled date shown to the minute it never had, and an empty bar that meant
// "nothing recorded" but read as "nothing happened".

import { describe, expect, it } from "vitest";
import {
  NOT_STATED,
  applicationsByDay,
  collapseRoles,
  dayKey,
  formatDecisionTime,
  funnelRows,
  rankLabels,
  roleKey,
  stageReached,
  type PostingRow,
} from "@/lib/analytics";

describe("dayKey", () => {
  it("puts the same instant on different days in different zones", () => {
    // The row that disappeared: applied on the evening of 31 August, Berlin
    // time it is already 1 September, and the machine that recorded it read
    // neither of those.
    const at = new Date("2026-08-31T22:25:00.000Z");
    expect(dayKey(at, "Europe/Berlin")).toBe("2026-09-01");
    expect(dayKey(at, "UTC")).toBe("2026-08-31");
    expect(dayKey(at, "America/Vancouver")).toBe("2026-08-31");
  });
});

describe("applicationsByDay", () => {
  const exact = (iso: string) => ({ at: new Date(iso), precision: "exact" as const });

  it("buckets in the zone it is given and fills the gap between days", () => {
    const rows = [
      exact("2026-08-31T22:25:00.000Z"),
      exact("2026-09-01T09:00:00.000Z"),
      exact("2026-09-03T09:00:00.000Z"),
    ];
    expect(applicationsByDay(rows, "Europe/Berlin").days).toEqual([
      { date: "2026-09-01", count: 2 },
      { date: "2026-09-02", count: 0 },
      { date: "2026-09-03", count: 1 },
    ]);
    expect(applicationsByDay(rows, "UTC").days).toEqual([
      { date: "2026-08-31", count: 1 },
      { date: "2026-09-01", count: 1 },
      { date: "2026-09-02", count: 0 },
      { date: "2026-09-03", count: 1 },
    ]);
  });

  it("keeps a day-precision instant on its own day in any zone", () => {
    const row = { at: new Date("2026-09-01T12:00:00.000Z"), precision: "day" as const };
    for (const zone of ["Europe/Berlin", "Pacific/Kiritimati", "Pacific/Midway"]) {
      expect(applicationsByDay([row], zone).days).toEqual([
        { date: "2026-09-01", count: 1 },
      ]);
    }
  });

  it("reports an application with no date instead of dropping or zeroing it", () => {
    const buckets = applicationsByDay(
      [exact("2026-09-01T09:00:00.000Z"), { at: null }],
      "Europe/Berlin",
    );
    expect(buckets.days).toEqual([{ date: "2026-09-01", count: 1 }]);
    expect(buckets.undated).toBe(1);
  });

  it("returns no days rather than an invented one when nothing is dated", () => {
    expect(applicationsByDay([{ at: null }, { at: null }], "UTC")).toEqual({
      days: [],
      undated: 2,
    });
  });
});

describe("formatDecisionTime", () => {
  it("prints a day-precision date without a time", () => {
    const at = new Date("2026-09-01T12:00:00.000Z");
    expect(formatDecisionTime(at, "day", "Europe/Berlin")).toBe("01 Sep 2026");
    expect(formatDecisionTime(at, "exact", "Europe/Berlin")).toBe("01 Sep 2026, 14:00");
  });

  it("prints a minute-precision instant in the reader's zone", () => {
    const at = new Date("2026-08-31T21:42:00.000Z");
    expect(formatDecisionTime(at, "minute", "Europe/Berlin")).toBe("31 Aug 2026, 23:42");
  });

  it("says so when there is no date at all", () => {
    expect(formatDecisionTime(null, "exact", "UTC")).toBe("date not recorded");
  });
});

describe("roleKey", () => {
  it("counts one opening published twice as one role", () => {
    // Grafana Labs posts one opening as four cards, one per country.
    expect(roleKey("Grafana Labs", "Senior Backend Engineer | Ireland | Remote")).toBe(
      roleKey("grafanalabs", "Senior Backend Engineer | Spain | Remote"),
    );
    // We Work Remotely appends the rate to a title Remotive carries plain.
    expect(roleKey("A.Team", "A.Team: Senior Developer ($90-$170/hr)")).toBe(
      roleKey("A.Team", "Senior Developer"),
    );
    expect(roleKey("Acme", "Backend Engineer (Remote)")).toBe(
      roleKey("Acme", "Backend Engineer"),
    );
  });

  it("keeps two different teams apart", () => {
    expect(roleKey("Affirm", "Backend Engineer (Lakehouse)")).not.toBe(
      roleKey("Affirm", "Backend Engineer (Batch)"),
    );
  });

  it("survives a company named in another alphabet", () => {
    // An earlier key stripped everything outside [a-z0-9], so every wholly
    // Cyrillic company collapsed into the same empty key.
    expect(roleKey("Яндекс", "Разработчик Python")).not.toBe(
      roleKey("Авито", "Разработчик Python"),
    );
  });
});

describe("collapseRoles", () => {
  const posting = (over: Partial<PostingRow>): PostingRow => ({
    company: "Grafana Labs",
    title: "Senior Backend Engineer",
    applied: false,
    decided: false,
    status: "new",
    appliedAt: null,
    appliedPrecision: null,
    source: null,
    location: null,
    ...over,
  });

  it("counts one opening published twice as one role, dated by the first application", () => {
    const roles = collapseRoles([
      posting({
        title: "Senior Backend Engineer | Ireland | Remote",
        applied: true,
        status: "applied",
        appliedAt: new Date("2026-09-02T10:00:00.000Z"),
        appliedPrecision: "exact",
        source: "LinkedIn",
      }),
      posting({
        title: "Senior Backend Engineer | Spain | Remote",
        applied: true,
        status: "applied",
        appliedAt: new Date("2026-09-01T10:00:00.000Z"),
        appliedPrecision: "minute",
        location: "Remote, Spain",
      }),
    ]);
    expect(roles).toHaveLength(1);
    expect(roles[0].postings).toBe(2);
    expect(roles[0].appliedAt).toEqual(new Date("2026-09-01T10:00:00.000Z"));
    expect(roles[0].appliedPrecision).toBe("minute");
    // Each label comes from whichever posting stated one.
    expect(roles[0].source).toBe("LinkedIn");
    expect(roles[0].location).toBe("Remote, Spain");
  });

  it("excludes an application that was taken back, date and all", () => {
    // Unchecking "applied" leaves appliedDate on the row — nothing clears it —
    // so a cancelled application would otherwise keep its bar on the chart.
    const roles = collapseRoles([
      posting({
        applied: false,
        status: "new",
        appliedAt: new Date("2026-09-01T10:00:00.000Z"),
        appliedPrecision: "exact",
      }),
    ]);
    expect(roles[0].applied).toBe(false);
    expect(roles[0].appliedAt).toBeNull();
  });

  it("reads an application off a status that is past applying", () => {
    // Only some of the paths that record an application set the flag.
    const roles = collapseRoles([posting({ applied: false, status: "interview" })]);
    expect(roles[0].applied).toBe(true);
    expect(roles[0].stage).toBe(1);
  });

  it("cannot make the collection funnel widen at its last step", () => {
    // Dragging a job to Offer sets the status and nothing else — no applied
    // flag, no feedback row. Repairing `applied` off the status but not
    // `decided` drew "Applied · 200% kept" under a narrower "Decided" bar.
    const roles = collapseRoles([
      posting({ company: "Apexon", applied: true, decided: true, status: "applied" }),
      posting({ company: "Neru Health", applied: false, decided: false, status: "offer" }),
    ]);
    expect(roles.filter((r) => r.applied)).toHaveLength(2);
    expect(roles.filter((r) => r.decided)).toHaveLength(2);
    const rows = funnelRows([
      { label: "Decided", count: roles.filter((r) => r.decided).length },
      { label: "Applied", count: roles.filter((r) => r.applied).length },
    ]);
    expect(rows[1].keptPct).toBe(100);
  });
});

describe("funnelRows", () => {
  it("measures each step against the one before it", () => {
    const rows = funnelRows([
      { label: "Jobs collected", count: 200 },
      { label: "Unique roles", count: 100 },
      { label: "Applied", count: 25 },
    ]);
    expect(rows.map((r) => r.keptPct)).toEqual([null, 50, 25]);
    expect(rows.map((r) => r.widthPct)).toEqual([100, 50, 13]);
  });

  it("does not divide by an empty step", () => {
    const rows = funnelRows([
      { label: "Jobs collected", count: 0 },
      { label: "Applied", count: 0 },
    ]);
    expect(rows.map((r) => r.keptPct)).toEqual([null, null]);
  });
});

describe("stageReached", () => {
  it("counts a role for every stage up to the furthest it reached", () => {
    expect(stageReached(["offer-accepted"])).toBe(3);
    expect(stageReached(["offer-declined"])).toBe(2);
    expect(stageReached(["applied", "interview"])).toBe(1);
    // A rejection overwrote whatever the row said before, so it claims no
    // stage at all rather than claiming the role never got an interview.
    expect(stageReached(["rejected"])).toBe(0);
  });
});

describe("rankLabels", () => {
  it("gives the unlabelled roles their own counted row", () => {
    const breakdown = rankLabels(
      [
        { label: "Toronto, Ontario, Canada", applied: true },
        { label: "Toronto, Ontario, Canada", applied: false },
        { label: "Berlin, Germany", applied: false },
        { label: null, applied: true },
        { label: "   ", applied: false },
      ],
      1,
    );
    expect(breakdown.rows).toEqual([
      { label: "Toronto, Ontario, Canada", collected: 2, applied: 1 },
    ]);
    expect(breakdown.notStated).toEqual({ label: NOT_STATED, collected: 2, applied: 1 });
    expect(breakdown.other).toEqual({
      label: "Other labels",
      labels: 1,
      collected: 1,
      applied: 0,
    });
  });
});
