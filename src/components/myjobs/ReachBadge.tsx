"use client";
import { Badge } from "../ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { parseReachData } from "@/lib/fit/reach";

// The reachability number, and on hover the terms that made it.
//
// Nobody ever sanity-checked the old panel's version of this score because it
// was never displayed — it only reordered the list. A number that reorders a
// list without being able to explain itself is read as a verdict about the job,
// when half the time it is a statement about the data, so the terms that did
// NOT fire are shown next to the ones that did.

function tone(score: number) {
  if (score >= 3) return "border-emerald-500/60 text-emerald-700 dark:text-emerald-400";
  if (score >= 1) return "border-amber-500/60 text-amber-700 dark:text-amber-400";
  return "border-muted-foreground/40 text-muted-foreground";
}

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function ReachBadge({
  reachScore,
  reachData,
  className = "",
}: {
  reachScore?: number | null;
  reachData?: string | null;
  className?: string;
}) {
  if (reachScore == null)
    return <span className={`text-xs text-muted-foreground ${className}`}>&mdash;</span>;

  const data = parseReachData(reachData);
  const lines = (data?.terms ?? []).map((t) => `${sign(t.value)}  ${t.label}`);
  if (data?.unknown?.length) lines.push(`not known: ${data.unknown.join(", ")}`);

  // Brings its own provider, like FitBadges: the card view has none, and the
  // table's nests harmlessly.
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`h-5 px-1.5 py-0 text-[11px] font-normal tabular-nums ${tone(
              reachScore,
            )} ${className}`}
          >
            {reachScore.toFixed(1)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-line">
          {lines.length
            ? `How reachable this is:\n${lines.join("\n")}`
            : "No terms recorded for this score."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
