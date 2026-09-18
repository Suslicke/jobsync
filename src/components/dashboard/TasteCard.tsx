import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTasteSummary } from "@/actions/feedback.actions";
import { MIN_DECISIONS } from "@/lib/fit/taste";

// What the user's own decisions say back to them.
//
// The point of the card is the middle column. An application means "this will
// do"; a pass names a boundary, and the boundaries are the only place the line
// is written down. Until there are enough decisions the card says so rather
// than showing a ranking built from three data points.

function ReasonList({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">nothing yet</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {rows.map(([label, count]) => (
            <li key={label} className="flex justify-between gap-2">
              <span className="truncate">{label}</span>
              <span className="tabular-nums text-muted-foreground">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Terms({ title, rows }: { title: string; rows: [string, number][] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className="text-sm leading-relaxed">{rows.map(([t]) => t).join(", ")}</p>
    </div>
  );
}

export default async function TasteCard() {
  const result = await getTasteSummary();
  if (!result?.success) return null;
  const taste = result.data;
  const decisions = taste.applied + taste.passed;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">What you liked</CardTitle>
        <p className="text-sm text-muted-foreground">
          {taste.applied} applications, {taste.passed} passes, {taste.rejected} rejections.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <ReasonList title="Liked" rows={taste.liked} />
          <ReasonList title="Worried you" rows={taste.worried} />
          <ReasonList title="Why you passed" rows={taste.passReasons} />
        </div>
        {taste.measured ? (
          <div className="grid gap-4 border-t pt-3 sm:grid-cols-2">
            <Terms title="Pulls you in" rows={taste.pulls} />
            <Terms title="Pushes you away" rows={taste.pushes} />
          </div>
        ) : (
          <p className="border-t pt-3 text-sm text-muted-foreground">
            Technology weights need at least {MIN_DECISIONS} of your own decisions
            to mean anything — {decisions} so far. An unmeasured signal is not a
            zero, so it stays out of the ranking until then.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
