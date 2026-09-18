"use client";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toastError, toastSuccess } from "@/lib/toast";
import { addJobFeedback } from "@/actions/feedback.actions";
import {
  APPLY_METHODS,
  LIKED_REASONS,
  PASS_REASONS,
  WORRY_REASONS,
  type FeedbackKind,
} from "@/models/feedback.model";

// Marking a job with one click records a decision that can be neither undone
// nor explained. This form is the pause: it asks what mattered while the reason
// is still in the user's head, and it can always be dismissed.

function Chips({
  options,
  selected,
  onToggle,
  tone = "neutral",
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(option)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              !on && "border-input text-muted-foreground hover:bg-muted",
              on && tone === "good" && "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              on && tone === "bad" && "border-red-500 bg-red-500/10 text-red-700 dark:text-red-400",
              on && tone === "neutral" && "border-primary bg-primary/10 text-foreground",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function JobFeedbackDialog({
  open,
  onOpenChange,
  jobId,
  kind,
  jobTitle,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  kind: FeedbackKind;
  jobTitle?: string;
  onSaved?: () => void;
}) {
  const [how, setHow] = useState<string[]>([]);
  const [liked, setLiked] = useState<string[]>([]);
  const [disliked, setDisliked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHow([]);
    setLiked([]);
    setDisliked([]);
    setNote("");
  }, [open, jobId, kind]);

  const toggle = (setter: (fn: (prev: string[]) => string[]) => void, single = false) =>
    (value: string) =>
      setter((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : single ? [value] : [...prev, value],
      );

  async function onSave() {
    setSaving(true);
    try {
      const result = await addJobFeedback(
        jobId,
        kind,
        liked,
        disliked,
        how[0],
        note.trim() || undefined,
      );
      if (result?.success) {
        toastSuccess(kind === "applied" ? "Application recorded." : "Reason recorded.");
        onOpenChange(false);
        onSaved?.();
      } else {
        toastError(result?.message || "Failed to save feedback.");
      }
    } finally {
      setSaving(false);
    }
  }

  const applied = kind === "applied";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{applied ? "Why did you apply?" : "Why are you passing?"}</DialogTitle>
          <DialogDescription>
            {jobTitle ? `${jobTitle}. ` : ""}
            {applied
              ? "Optional — but this is what teaches the ranking what you like."
              : "A pass names a boundary, which says more about your taste than an application does."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {applied && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">How you applied</p>
              <Chips options={APPLY_METHODS} selected={how} onToggle={toggle(setHow, true)} />
            </div>
          )}

          {applied && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">What you liked</p>
              <Chips
                options={LIKED_REASONS}
                selected={liked}
                onToggle={toggle(setLiked)}
                tone="good"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              {applied ? "What worries you" : "Why you are not applying"}
            </p>
            <Chips
              options={applied ? WORRY_REASONS : PASS_REASONS}
              selected={disliked}
              onToggle={toggle(setDisliked)}
              tone="bad"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Note</p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="what mattered — in your own words"
              className="h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Skip
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {applied ? "Record application" : "Record reason"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
