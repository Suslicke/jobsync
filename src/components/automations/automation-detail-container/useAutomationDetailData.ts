"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toastError } from "@/lib/toast";
import {
  getAutomationById,
  getAutomationRuns,
  getDiscoveredJobs,
} from "@/actions/automation.actions";
import type {
  AutomationWithResume,
  AutomationRun,
  DiscoveredJob,
  DiscoveredSortBy,
  DiscoveryStatus,
} from "@/models/automation.model";
import { APP_CONSTANTS } from "@/lib/constants";

// Owns the automation record plus its paginated runs and discovered jobs.
export function useAutomationDetailData(automationId: string) {
  const router = useRouter();

  const [automation, setAutomation] = useState<AutomationWithResume | null>(
    null,
  );
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [runsPage, setRunsPage] = useState(1);
  const [totalRuns, setTotalRuns] = useState(0);
  const [runsLoadingMore, setRunsLoadingMore] = useState(false);
  const [jobs, setJobs] = useState<DiscoveredJob[]>([]);
  const [jobsPage, setJobsPage] = useState(1);
  const [totalJobs, setTotalJobs] = useState(0);
  const [jobsLoadingMore, setJobsLoadingMore] = useState(false);
  const [jobStatusCounts, setJobStatusCounts] = useState<{
    new: number;
    dismissed: number;
    accepted: number;
  }>({ new: 0, dismissed: 0, accepted: 0 });
  const [statusFilter, setStatusFilter] = useState<DiscoveryStatus[]>([
    "new",
    "accepted",
  ]);
  // Mirrors statusFilter for loadData, which must not depend on statusFilter
  // directly (that would re-trigger its mount effect and flash the full-page
  // loading state whenever the filter changes).
  const statusFilterRef = useRef(statusFilter);
  useEffect(() => {
    statusFilterRef.current = statusFilter;
  }, [statusFilter]);
  const [sortBy, setSortBy] = useState<DiscoveredSortBy>("matchScore");
  // Same reason as statusFilterRef: fetchJobs must not change identity when the
  // order does, or the mount effect re-runs and flashes the loading state.
  const sortByRef = useRef(sortBy);
  useEffect(() => {
    sortByRef.current = sortBy;
  }, [sortBy]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(
    (filter: DiscoveryStatus[], page = 1, sort: DiscoveredSortBy = sortByRef.current) =>
      getDiscoveredJobs({
        automationId,
        discoveryStatus: filter,
        page,
        limit: APP_CONSTANTS.RECORDS_PER_PAGE,
        sortBy: sort,
      }),
    [automationId],
  );

  const loadData = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const [automationResult, runsResult, jobsResult] = await Promise.all([
          getAutomationById(automationId),
          getAutomationRuns(automationId, {
            page: 1,
            limit: APP_CONSTANTS.RECORDS_PER_PAGE,
          }),
          fetchJobs(statusFilterRef.current),
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

        if (jobsResult.success && jobsResult.data) {
          setJobs(jobsResult.data);
          setTotalJobs(jobsResult.total ?? 0);
          setJobsPage(1);
          if (jobsResult.statusCounts) {
            setJobStatusCounts(jobsResult.statusCounts);
          }
        }
      } catch (error) {
        toastError("Failed to load automation details");
      }
      if (showLoading) setLoading(false);
    },
    [automationId, router, fetchJobs],
  );

  useEffect(() => {
    // Only the initial load shows the full-page spinner. Background refreshes
    // (run watcher, pause/resume, deletes) must not unmount the page — doing so
    // remounts LogsTab while runKey is still > 0, which re-initializes its badge
    // to "Running" and then rejects the completed SSE snapshot.
    loadData(true);
  }, [loadData]);

  const refreshJobs = useCallback(async () => {
    const jobsResult = await fetchJobs(statusFilter);
    if (jobsResult.success && jobsResult.data) {
      setJobs(jobsResult.data);
      setTotalJobs(jobsResult.total ?? 0);
      setJobsPage(1);
      if (jobsResult.statusCounts) {
        setJobStatusCounts(jobsResult.statusCounts);
      }
    }
  }, [fetchJobs, statusFilter]);

  const loadMoreJobs = useCallback(async () => {
    setJobsLoadingMore(true);
    try {
      const nextPage = jobsPage + 1;
      const jobsResult = await fetchJobs(statusFilter, nextPage);
      if (jobsResult.success && jobsResult.data) {
        setJobs((prev) => [...prev, ...jobsResult.data!]);
        setTotalJobs(jobsResult.total ?? 0);
        setJobsPage(nextPage);
      }
    } finally {
      setJobsLoadingMore(false);
    }
  }, [fetchJobs, jobsPage, statusFilter]);

  const handleStatusFilterChange = useCallback(
    async (filter: DiscoveryStatus[]) => {
      setStatusFilter(filter);
      const jobsResult = await fetchJobs(filter);
      if (jobsResult.success && jobsResult.data) {
        setJobs(jobsResult.data);
        setTotalJobs(jobsResult.total ?? 0);
        setJobsPage(1);
        if (jobsResult.statusCounts) {
          setJobStatusCounts(jobsResult.statusCounts);
        }
      }
    },
    [fetchJobs],
  );

  const handleSortByChange = useCallback(
    async (next: DiscoveredSortBy) => {
      setSortBy(next);
      // Paging is server-side, so a new order means a new first page: keeping
      // the loaded rows would mix two rankings in one list.
      const jobsResult = await fetchJobs(statusFilter, 1, next);
      if (jobsResult.success && jobsResult.data) {
        setJobs(jobsResult.data);
        setTotalJobs(jobsResult.total ?? 0);
        setJobsPage(1);
      }
    },
    [fetchJobs, statusFilter],
  );

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
    statusFilter,
    sortBy,
    loading,
    loadData,
    refreshJobs,
    loadMoreJobs,
    loadMoreRuns,
    handleStatusFilterChange,
    handleSortByChange,
  };
}
