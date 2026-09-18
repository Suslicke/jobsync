"use client";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Loader2, RefreshCw } from "lucide-react";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  getFitProfile,
  recalculateFits,
  saveFitProfile,
} from "@/actions/fit.actions";

// The profile is edited as JSON on purpose: it is a dictionary of a few hundred
// technology names plus a handful of numbers, and a form for that would be a
// worse way to move it between machines than a paste box.

function FitProfileSettings() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState("");

  useEffect(() => {
    (async () => {
      const result = await getFitProfile();
      if (result?.success) {
        setValue(JSON.stringify(result.data.profile, null, 2));
        setCustom(result.data.custom);
      } else {
        toastError(result?.message || "Failed to load fit profile.");
      }
      setIsLoading(false);
    })();
  }, []);

  async function onSave(json: string) {
    setIsSaving(true);
    try {
      const result = await saveFitProfile(json);
      if (result?.success) {
        toastSuccess(result.message ?? "Profile saved.");
        setCustom(Boolean(json.trim()));
      } else {
        toastError(result?.message || "Failed to save fit profile.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function onRecalculate() {
    setIsRebuilding(true);
    try {
      const result = await recalculateFits();
      if (result?.success) toastSuccess(result.message ?? "Done.");
      else toastError(result?.message || "Failed to recalculate.");
    } finally {
      setIsRebuilding(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading profile...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Fit profile</h3>
        <p className="text-sm text-muted-foreground">
          What counts as your stack, your discipline and your years. Every job is
          analyzed against this offline — no AI provider involved — and the badges
          on the job list come from it.{" "}
          {custom
            ? "You are using a custom profile."
            : "You are using the built-in default."}
        </p>
      </div>

      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        className="font-mono text-xs h-[420px]"
      />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onSave(value)} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save and re-analyze
        </Button>
        <Button variant="outline" onClick={onRecalculate} disabled={isRebuilding}>
          {isRebuilding ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Re-analyze stale jobs
        </Button>
        <Button
          variant="ghost"
          disabled={isSaving || !custom}
          onClick={() => onSave("")}
        >
          Reset to default
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Saving rebuilds the analysis of every job, because the rules it was made
        with have changed. On a large database that takes a moment.
      </p>
    </div>
  );
}

export default FitProfileSettings;
