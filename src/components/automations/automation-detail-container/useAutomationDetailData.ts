"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toastError } from "@/lib/toast";
import {
  getAutomationById,
  getAutomationRuns,
} from "@/actions/automation.actions";
import type {
  AutomationWithResume,
  AutomationRun,
} from "@/models/automation.model";
import { APP_CONSTANTS } from "@/lib/constants";
import { useDiscoveredJobs } from "../discovered-jobs-list/useDiscoveredJobs";

// Owns the automation record plus its paginated runs; the discovered jobs come
// from the hook the combined list uses too.
export function useAutomationDetailData(automationId: string) {
  const router = useRouter();

  const [automation, setAutomation] = useState<AutomationWithResume | null>(
    null,
  );
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [runsPage, setRunsPage] = useState(1);
  const [totalRuns, setTotalRuns] = useState(0);
  const [runsLoadingMore, setRunsLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const {
    jobs,
    totalJobs,
    jobsLoadingMore,
    jobStatusCounts,
    query,
    setQuery,
    refreshJobs,
    loadMoreJobs,
  } = useDiscoveredJobs(automationId);

  const loadData = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const [automationResult, runsResult] = await Promise.all([
          getAutomationById(automationId),
          getAutomationRuns(automationId, {
            page: 1,
            limit: APP_CONSTANTS.RECORDS_PER_PAGE,
          }),
          refreshJobs(),
        ]);

        if (automationResult.success && automationResult.data) {
          setAutomation(automationResult.data);
          setRuns(automationResult.data.runs || []);
        } else {
          toastError(automationResult.message || "Automation not found");
          router.push("/dashboard/automations");
          return;
        }

        if (runsResult.success && runsResult.data) {
          setRuns(runsResult.data);
          setTotalRuns(runsResult.total ?? 0);
          setRunsPage(1);
        }
      } catch (error) {
        toastError("Failed to load automation details");
      }
      if (showLoading) setLoading(false);
    },
    [automationId, router, refreshJobs],
  );

  useEffect(() => {
    // Only the initial load shows the full-page spinner. Background refreshes
    // (run watcher, pause/resume, deletes) must not unmount the page — doing so
    // remounts LogsTab while runKey is still > 0, which re-initializes its badge
    // to "Running" and then rejects the completed SSE snapshot.
    loadData(true);
  }, [loadData]);

  const loadMoreRuns = useCallback(async () => {
    setRunsLoadingMore(true);
    try {
      const nextPage = runsPage + 1;
      const runsResult = await getAutomationRuns(automationId, {
        page: nextPage,
        limit: APP_CONSTANTS.RECORDS_PER_PAGE,
      });
      if (runsResult.success && runsResult.data) {
        setRuns((prev) => [...prev, ...runsResult.data!]);
        setTotalRuns(runsResult.total ?? 0);
        setRunsPage(nextPage);
      }
    } finally {
      setRunsLoadingMore(false);
    }
  }, [automationId, runsPage]);

  return {
    automation,
    runs,
    totalRuns,
    runsLoadingMore,
    jobs,
    totalJobs,
    jobsLoadingMore,
    jobStatusCounts,
    query,
    setQuery,
    loading,
    loadData,
    refreshJobs,
    loadMoreJobs,
    loadMoreRuns,
  };
}
