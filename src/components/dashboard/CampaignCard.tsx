import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import type { CampaignAnalytics } from "@/actions/dashboard.actions";
import type { FunnelRow, LabelBreakdown } from "@/lib/analytics";

// The campaign in openings rather than in rows, and in two separate funnels.
// They answer different questions and were once drawn as one chart that got
// WIDER in the middle: the collection funnel is about the pipeline and each of
// its steps is measured on the step above, while the response funnel is about
// what the employers did with the applications.

function Funnel({ rows }: { rows: FunnelRow[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 tabular-nums">
              {row.count.toLocaleString()}
              {row.keptPct !== null && (
                <span className="ml-2 text-muted-foreground">
                  {row.keptPct}% kept
                </span>
              )}
            </span>
          </div>
          <div className="h-2 rounded-sm bg-muted">
            <div
              className="h-2 rounded-sm bg-primary"
              style={{ width: `${row.widthPct}%` }}
            />
          </div>
          {row.note && (
            <p className="text-xs text-muted-foreground">{row.note}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// Labels ranked, not a map. Measured over the pool this migration feeds on, a
// country classifier placed 78% of the labels — but "placed" counted regex
// hits, and Waterloo/Belgium, Ontario/California and Vancouver/WA all came out
// as Canada, the one country the campaign is aimed at. A choropleth is worse
// still: an unpainted country and a country with no jobs are the same pixels.
function Labels({
  breakdown,
  emptyNote,
}: {
  breakdown: LabelBreakdown;
  emptyNote: string;
}) {
  const rows = [
    ...breakdown.rows,
    ...(breakdown.other.collected > 0
      ? [
          {
            ...breakdown.other,
            label: `${breakdown.other.label} (${breakdown.other.labels})`,
          },
        ]
      : []),
    // Always last and always shown when it is not empty: an absent row reads
    // as a zero, and "nobody said" is not zero.
    ...(breakdown.notStated.collected > 0 ? [breakdown.notStated] : []),
  ];
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">{emptyNote}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-muted-foreground">
          <th className="text-left font-medium">Label</th>
          <th className="w-20 text-right font-medium">Roles</th>
          <th className="w-20 text-right font-medium">Applied</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="truncate py-0.5">{row.label}</td>
            <td className="py-0.5 text-right tabular-nums">{row.collected}</td>
            <td className="py-0.5 text-right tabular-nums text-muted-foreground">
              {row.applied}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export default function CampaignCard({ data }: { data: CampaignAnalytics }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-green-600">Campaign</CardTitle>
        <p className="text-sm text-muted-foreground">
          {data.roles.toLocaleString()} openings behind{" "}
          {data.postings.toLocaleString()} saved postings. Every number on this
          card counts openings, so one role published on four boards is one.
        </p>
      </CardHeader>
      <CardContent className="grid gap-6 @2xl:grid-cols-2">
        <Section title="From collected to applied">
          <Funnel rows={data.collection} />
        </Section>
        <Section
          title="Employer responses"
          note={
            data.rejected > 0
              ? `${data.rejected} rejected. A status is overwritten in place, so a role rejected after an interview counts here as applied only — these stages are a floor, not a measurement.`
              : "A status is overwritten in place, so these stages are a floor: a role that was interviewed and then rejected reads as applied only."
          }
        >
          <Funnel rows={data.responses} />
        </Section>
        <Section title="Where the jobs came from">
          <Labels
            breakdown={data.sources}
            emptyNote="No source recorded on any saved job yet."
          />
        </Section>
        <Section title="Where the applications went">
          <Labels
            breakdown={data.locations}
            emptyNote="No location recorded on any saved job yet."
          />
        </Section>
      </CardContent>
    </Card>
  );
}
