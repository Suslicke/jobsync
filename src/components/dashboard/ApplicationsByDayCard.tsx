"use client";

import { useEffect, useMemo, useState } from "react";
import { ResponsiveBar } from "@nivo/bar";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { JOBS_BAR_COLOR } from "./jobsActivityChart";
import {
  applicationsByDay,
  formatDay,
  formatDecisionTime,
  type TimePrecision,
} from "@/lib/analytics";

// When applications were sent, one bar per day — and the day is decided here,
// in the browser, not on the server. The server runs wherever it runs: the
// machine that recorded this history lived on +05, and reading its days in its
// own zone put fourteen evening applications onto the following day and made
// 31 August disappear from the chart altogether.

export interface ApplicationRow {
  at: string | null;
  precision: TimePrecision | null;
}

export default function ApplicationsByDayCard({
  applications,
  timeZone,
}: {
  applications: ApplicationRow[];
  /** The zone chosen in Settings. Undefined means "follow this browser". */
  timeZone?: string;
}) {
  // Resolved after mount, because on the server Intl answers with the server's
  // zone — the one answer that is never right. Until it resolves there is
  // nothing to draw, rather than a chart drawn in the wrong zone for a frame.
  const [zone, setZone] = useState<string | null>(timeZone ?? null);
  useEffect(() => {
    setZone(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  }, [timeZone]);

  const buckets = useMemo(() => {
    if (!zone) return null;
    return applicationsByDay(
      applications.map((a) => ({
        at: a.at ? new Date(a.at) : null,
        precision: a.precision,
      })),
      zone,
    );
  }, [applications, zone]);

  const approximate = applications.filter((a) => a.precision === "minute").length;
  const dayOnly = applications.filter((a) => a.precision === "day").length;
  const dates = applications
    .filter((a) => a.at)
    .map((a) => ({ at: new Date(a.at as string), precision: a.precision }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = dates[0];
  const last = dates[dates.length - 1];

  const data = (buckets?.days ?? []).map((d) => ({
    day: formatDay(d.date),
    value: d.count,
  }));
  const dated = (buckets?.days ?? []).reduce((sum, d) => sum + d.count, 0);
  const maxValue = Math.max(0, ...data.map((d) => d.value));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-green-600">
          Applications per day
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {buckets === null ? (
            "Reading your time zone…"
          ) : (
            <>
              {dated} {dated === 1 ? "role" : "roles"} over {buckets.days.length}{" "}
              {buckets.days.length === 1 ? "day" : "days"}
              {buckets.days.length > 0 &&
                ` · ${(dated / buckets.days.length).toFixed(1)}/day`}
              {" · days counted in "}
              {zone}
              {!timeZone && " (this browser)"}
            </>
          )}
        </p>
        {buckets !== null && zone && dates.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {`First ${formatDecisionTime(first.at, first.precision, zone)}, latest ${formatDecisionTime(last.at, last.precision, zone)}.`}
            {approximate > 0 &&
              ` ${approximate} timestamps were recovered from run logs and are accurate to the run, not to the application.`}
            {dayOnly > 0 &&
              ` ${dayOnly} ${dayOnly === 1 ? "is" : "are"} known only to the day and ${dayOnly === 1 ? "is" : "are"} written without a time.`}
            {buckets.undated > 0 &&
              ` ${buckets.undated} carry no date at all and are not on the chart.`}
          </p>
        )}
      </CardHeader>
      <CardContent className="h-[240px] p-3 pt-1">
        <div className="h-[200px]">
          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {buckets === null
                ? ""
                : "No application carries a date yet, so there is nothing to place on a day."}
            </p>
          ) : (
            <ResponsiveBar
              data={data}
              keys={["value"]}
              indexBy="day"
              margin={{ top: 20, right: 10, bottom: 60, left: 45 }}
              padding={0.4}
              colors={JOBS_BAR_COLOR}
              valueFormat={(value) => value.toFixed(0)}
              theme={{
                text: { fill: "#9ca3af" },
                tooltip: { container: { background: "#1e293b", color: "#fff" } },
              }}
              axisTop={null}
              axisRight={null}
              enableGridX={false}
              enableGridY={false}
              enableLabel={false}
              axisBottom={{
                tickSize: 5,
                tickPadding: 5,
                tickRotation: -45,
                // Every day is a bar, but only some days get a label: a long
                // campaign has more days than the axis has room for.
                tickValues: data
                  .filter((_, i) => i % Math.ceil(data.length / 8) === 0)
                  .map((d) => d.day),
                truncateTickAt: 0,
              }}
              axisLeft={{
                tickSize: 5,
                tickPadding: 5,
                tickRotation: 0,
                legend: "ROLES APPLIED TO",
                legendPosition: "middle",
                legendOffset: -40,
                tickValues: Array.from({ length: maxValue + 1 }, (_, i) => i),
                truncateTickAt: 0,
              }}
              motionConfig="gentle"
              tooltip={({ value, indexValue }) => (
                <div
                  style={{
                    background: "#1e293b",
                    color: "#fff",
                    padding: "6px 10px",
                    borderRadius: 4,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                  }}
                >
                  {indexValue}: <strong>{value}</strong>
                </div>
              )}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
