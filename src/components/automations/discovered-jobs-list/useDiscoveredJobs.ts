"use client";

import { useCallback, useRef, useState } from "react";
import { getDiscoveredJobs } from "@/actions/automation.actions";
import type {
  DiscoveredJob,
  DiscoveredQuery,
} from "@/models/automation.model";
import { APP_CONSTANTS } from "@/lib/constants";

export const DEFAULT_DISCOVERED_QUERY: DiscoveredQuery = {
  // Dismissed rows are kept as the runner's memory of what it has seen, not
  // as something to read.
  statusFilter: ["new", "accepted"],
  sortBy: "matchScore",
  maxAgeDays: 0,
  only: [],
};

/**
 * The discovered pile and what narrows it — one automation's, or with no id
 * every automation's at once.
 *
 * The query lives in a ref as well as in state. Every path that loads jobs
 * reads the ref, so `refreshJobs` keeps one identity whatever the filters are:
 * the automation page calls it from a mount effect, and a callback that
 * changed with each filter would re-run that effect and flash the full-page
 * spinner on every click.
 */
export function useDiscoveredJobs(fixedAutomationId?: string) {
  const [query, setQueryState] = useState(DEFAULT_DISCOVERED_QUERY);
  const queryRef = useRef(query);
  const [jobs, setJobs] = useState<DiscoveredJob[]>([]);
  const [page, setPage] = useState(1);
  const [totalJobs, setTotalJobs] = useState(0);
  const [jobsLoadingMore, setJobsLoadingMore] = useState(false);
  const [jobStatusCounts, setJobStatusCounts] = useState({
    new: 0,
    dismissed: 0,
    accepted: 0,
  });

  const fetchPage = useCallback(
    (pageNumber: number) => {
      const q = queryRef.current;
      return getDiscoveredJobs({
        automationId: fixedAutomationId ?? q.automationId,
        discoveryStatus: q.statusFilter,
        page: pageNumber,
        limit: APP_CONSTANTS.RECORDS_PER_PAGE,
        sortBy: q.sortBy,
        maxAgeDays: q.maxAgeDays || undefined,
        only: q.only,
      });
    },
    [fixedAutomationId],
  );

  // Paging is server-side, so anything that changes the query means a new
  // first page: keeping the loaded rows would mix two rankings in one list.
  const refreshJobs = useCallback(async () => {
    const result = await fetchPage(1);
    if (!result.success || !result.data) return;
    setJobs(result.data);
    setTotalJobs(result.total ?? 0);
    setPage(1);
    if (result.statusCounts) setJobStatusCounts(result.statusCounts);
  }, [fetchPage]);

  const setQuery = useCallback(
    async (patch: Partial<DiscoveredQuery>) => {
      // The ref moves before the fetch, not in an effect: the request below
      // must already carry the new query.
      queryRef.current = { ...queryRef.current, ...patch };
      setQueryState(queryRef.current);
      await refreshJobs();
    },
    [refreshJobs],
  );

  const loadMoreJobs = useCallback(async () => {
    setJobsLoadingMore(true);
    try {
      const result = await fetchPage(page + 1);
      if (result.success && result.data) {
        setJobs((prev) => [...prev, ...result.data!]);
        setTotalJobs(result.total ?? 0);
        setPage(page + 1);
      }
    } finally {
      setJobsLoadingMore(false);
    }
  }, [fetchPage, page]);

  return {
    jobs,
    totalJobs,
    jobsLoadingMore,
    jobStatusCounts,
    query,
    setQuery,
    refreshJobs,
    loadMoreJobs,
  };
}
