"use client";

import { useState, useEffect } from "react";
import { toastSuccess, toastError } from "@/lib/toast";
import type { DiscoveredJob } from "@/models/automation.model";
import {
  acceptDiscoveredJob,
  dismissDiscoveredJob,
  dismissOldDiscoveredJobs,
  analyzeDiscoveredJob,
} from "@/actions/automation.actions";

// Per-job analyze/accept/dismiss, serialized through a single loading id so the
// parent can also block starting a run while one is in flight.
export function useDiscoveredJobActions(
  onRefresh: () => void,
  onBusyChange?: (busy: boolean) => void,
) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  useEffect(() => {
    onBusyChange?.(loadingAction !== null);
  }, [loadingAction, onBusyChange]);

  const handleAnalyze = async (jobId: string) => {
    setLoadingAction(jobId);
    try {
      const result = await analyzeDiscoveredJob(jobId);
      if (result.success) {
        toastSuccess("AI match score is ready.", "Match analyzed");
        onRefresh();
      } else {
        toastError(result.message);
      }
    } catch {
      toastError("Failed to analyze job");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAccept = async (job: DiscoveredJob) => {
    setLoadingAction(job.id);
    try {
      const result = await acceptDiscoveredJob(job.id);
      if (result.success) {
        toastSuccess("The job has been added to your tracked jobs.", "Job accepted");
        onRefresh();
      } else {
        toastError(result.message);
      }
    } catch {
      toastError("Failed to accept job");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDismiss = async (jobId: string) => {
    setLoadingAction(jobId);
    try {
      const result = await dismissDiscoveredJob(jobId);
      if (result.success) {
        toastSuccess("Job dismissed");
        onRefresh();
      } else {
        toastError(result.message);
      }
    } catch {
      toastError("Failed to dismiss job");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDismissOlderThan = async (automationId: string, days: number) => {
    // ponytail: native confirm — one bulk action does not earn a dialog
    // component; swap in AlertDialog if more bulk actions arrive.
    if (!window.confirm(`Dismiss every new job discovered more than ${days} days ago?`)) return;
    const result = await dismissOldDiscoveredJobs({ automationId, olderThanDays: days });
    if (result.success) {
      toastSuccess(`Dismissed ${result.dismissed ?? 0} job(s).`, "Old jobs dismissed");
      onRefresh();
    } else {
      toastError(result.message);
    }
  };

  return {
    loadingAction,
    handleAnalyze,
    handleAccept,
    handleDismiss,
    handleDismissOlderThan,
  };
}
