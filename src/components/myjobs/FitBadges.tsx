"use client";
import { Badge } from "../ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { parseFitData, type FitData } from "@/lib/fit";

// The offline analysis in one line under a job title. Its job is to say why a
// row is worth opening — or why it is not — without opening it.
//
// "Not measured" is shown as its own state, never as 0%: a posting collected
// without a description knows nothing about itself, and a zero would read as a
// verdict instead of as silence.

function pctTone(pct: number) {
  if (pct >= 70)
    return "border-emerald-500/60 text-emerald-700 dark:text-emerald-400";
  if (pct >= 45)
    return "border-amber-500/60 text-amber-700 dark:text-amber-400";
  return "border-red-500/60 text-red-700 dark:text-red-400";
}

export function FitBadges({
  fitData,
  className = "",
  max = 2,
}: {
  fitData?: string | null;
  className?: string;
  max?: number;
}) {
  const fit: FitData | null = parseFitData(fitData);
  if (!fit) return null;

  const stackTerms = Object.entries(fit.stack ?? {})
    .map(([tier, terms]) => `${tier}: ${(terms ?? []).join(", ")}`)
    .join("\n");

  return (
    <TooltipProvider delayDuration={300}>
      <div className={`flex flex-wrap items-center gap-1 ${className}`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={`h-5 px-1.5 py-0 text-[11px] font-normal ${
                fit.pct == null ? "text-muted-foreground" : pctTone(fit.pct)
              }`}
            >
              {fit.pct == null ? "not measured" : `${fit.pct}% stack`}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-line">
            {fit.pct == null
              ? `Too few named technologies to measure (${fit.termsScored}).`
              : `${fit.termsScored} technologies named.\n${stackTerms}`}
          </TooltipContent>
        </Tooltip>

        {fit.discipline !== "unknown" && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 py-0 text-[11px] font-normal text-muted-foreground"
          >
            {fit.discipline}
            {fit.track !== "ic" ? ` · ${fit.track}` : ""}
          </Badge>
        )}

        {fit.visaSponsorship && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 py-0 text-[11px] font-normal border-emerald-500/60 text-emerald-700 dark:text-emerald-400"
          >
            visa
          </Badge>
        )}
        {fit.visaRefused && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 py-0 text-[11px] font-normal border-red-500/60 text-red-700 dark:text-red-400"
          >
            no visa
          </Badge>
        )}

        {/* Only where sponsorship was not promised: that is the whole point of
            the badge. "Relocation package" pays to move the boxes and says
            nothing about a work permit, and reading it as one costs an
            application. Beside a "visa" badge it would add nothing. */}
        {fit.relocation && !fit.visaSponsorship && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="h-5 px-1.5 py-0 text-[11px] font-normal border-amber-500/60 text-amber-700 dark:text-amber-400"
              >
                relocation only
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Relocation help is offered; a work permit is not mentioned.
            </TooltipContent>
          </Tooltip>
        )}

        {/* An off-role title arrives as a blocker. "Unclear" is not a blocker —
            it is a posting whose title named nothing either way, and it is
            shown so it can be opened rather than trusted. */}
        {fit.role === "unclear" && (
          <Badge
            variant="outline"
            className="h-5 px-1.5 py-0 text-[11px] font-normal text-muted-foreground"
          >
            role unclear
          </Badge>
        )}

        {fit.blockers.slice(0, max).map((b) => (
          <Badge
            key={b}
            variant="outline"
            className="h-5 px-1.5 py-0 text-[11px] font-normal border-red-500/60 text-red-700 dark:text-red-400"
          >
            {b}
          </Badge>
        ))}
        {fit.blockers.length > max && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="h-5 px-1.5 py-0 text-[11px] font-normal text-muted-foreground"
              >
                +{fit.blockers.length - max}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-pre-line">
              {fit.blockers.join("\n")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
