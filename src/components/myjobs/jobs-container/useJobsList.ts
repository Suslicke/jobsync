"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getJobsList } from "@/actions/job.actions";
import { toastError } from "@/lib/toast";
import { JobResponse, JobsViewMode, type JobSort, type JobSortField } from "@/models/job.model";
import { APP_CONSTANTS } from "@/lib/constants";
import {
  getFromLocalStorage,
  saveToLocalStorage,
} from "@/utils/localstorage.utils";
import { useAgentChat } from "@/components/agent/AgentChatProvider";

// Owns the job list itself: pagination, search, view mode, infinite scroll,
// and the reload triggered when the agent chat writes job data.
export function useJobsList({
  companyFilter,
  appliedFilter,
  titleFilter,
  locationFilter,
  sourceFilter,
}: {
  companyFilter: string | null;
  appliedFilter: boolean;
  titleFilter: string | null;
  locationFilter: string | null;
  sourceFilter: string | null;
}) {
  const { jobWrites } = useAgentChat();
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [viewMode, setViewMode] = useState<JobsViewMode>("table");
  const [page, setPage] = useState(1);
  const [totalJobs, setTotalJobs] = useState(0);
  const [filterKey, setFilterKey] = useState<string>("none");
  const [searchTerm, setSearchTerm] = useState("");
  const [sort, setSort] = useState<JobSort[]>([]);
  const [initialLoading, setInitialLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const hasSearched = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Read after mount: localStorage is unavailable during SSR, so seeding the
  // initial state from it would cause a hydration mismatch.
  useEffect(() => {
    const saved = getFromLocalStorage(
      APP_CONSTANTS.JOBS_VIEW_MODE_STORAGE_KEY,
      null,
    );
    if (saved === "cards" || saved === "table") setViewMode(saved);
    const savedSort = getFromLocalStorage(APP_CONSTANTS.JOBS_SORT_STORAGE_KEY, null);
    if (Array.isArray(savedSort)) setSort(savedSort as JobSort[]);
  }, []);

  const onChangeViewMode = (mode: JobsViewMode) => {
    setViewMode(mode);
    saveToLocalStorage(APP_CONSTANTS.JOBS_VIEW_MODE_STORAGE_KEY, mode);
  };

  // Click a column to sort by it alone; shift-click adds it as a tie-breaker
  // after the columns already chosen. Cycle per column: desc -> asc -> off.
  const toggleSort = (field: JobSortField, additive = false) => {
    setSort((prev) => {
      const current = prev.find((s) => s.field === field);
      const nextDir = !current ? "desc" : current.dir === "desc" ? "asc" : null;
      let next: JobSort[];
      if (!additive) {
        next = nextDir ? [{ field, dir: nextDir }] : [];
      } else if (!current) {
        next = [...prev, { field, dir: "desc" }];
      } else if (nextDir) {
        next = prev.map((s) => (s.field === field ? { field, dir: nextDir } : s));
      } else {
        next = prev.filter((s) => s.field !== field);
      }
      saveToLocalStorage(APP_CONSTANTS.JOBS_SORT_STORAGE_KEY, next);
      return next;
    });
  };

  const jobsPerPage = APP_CONSTANTS.RECORDS_PER_PAGE;

  const loadJobs = useCallback(
    async (page: number, filter?: string, search?: string) => {
      if (page === 1) setInitialLoading(true);
      else setLoadingMore(true);
      const { success, data, total, message } = await getJobsList(
        page,
        jobsPerPage,
        filter && filter !== "none" ? filter : undefined,
        search,
        companyFilter || undefined,
        appliedFilter || undefined,
        titleFilter || undefined,
        locationFilter || undefined,
        sourceFilter || undefined,
        sort,
      );
      if (success && data) {
        setJobs((prev) => (page === 1 ? data : [...prev, ...data]));
        setTotalJobs(total);
        setPage(page);
      } else {
        toastError(message);
      }
      setInitialLoading(false);
      setLoadingMore(false);
    },
    [
      jobsPerPage,
      companyFilter,
      appliedFilter,
      titleFilter,
      locationFilter,
      sourceFilter,
      sort,
    ],
  );

  const reloadJobs = useCallback(async () => {
    await loadJobs(1, undefined, searchTerm || undefined);
    if (filterKey !== "none") {
      setFilterKey("none");
    }
  }, [loadJobs, filterKey, searchTerm]);

  useEffect(() => {
    (async () => await loadJobs(1))();
  }, [loadJobs]);

  // The agent saves server-side, so only this counter tells us a row appeared
  // or a match score landed. Deps are the counter alone: reloadJobs changes
  // with every filter and keystroke, and the effects above already cover those.
  useEffect(() => {
    if (jobWrites === 0) return;
    void reloadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobWrites]);

  useEffect(() => {
    if (searchTerm !== "") {
      hasSearched.current = true;
    }
    // Skip only on initial mount when search is empty
    if (searchTerm === "" && !hasSearched.current) return;

    const timer = setTimeout(() => {
      loadJobs(1, filterKey, searchTerm || undefined);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  // Infinite scroll: auto-load next page when sentinel is visible
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          !initialLoading &&
          !loadingMore &&
          jobs.length < totalJobs
        ) {
          loadJobs(page + 1, filterKey, searchTerm || undefined);
        }
      },
      { threshold: APP_CONSTANTS.INTERSECTION_OBSERVER_THRESHOLD },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    jobs.length,
    totalJobs,
    page,
    filterKey,
    searchTerm,
    initialLoading,
    loadingMore,
    loadJobs,
  ]);

  const onFilterChange = (filterBy: string) => {
    setFilterKey(filterBy);
    loadJobs(1, filterBy, searchTerm || undefined);
  };

  return {
    jobs,
    viewMode,
    onChangeViewMode,
    page,
    totalJobs,
    filterKey,
    searchTerm,
    setSearchTerm,
    initialLoading,
    loadingMore,
    loadJobs,
    reloadJobs,
    onFilterChange,
    sentinelRef,
    sort,
    toggleSort,
  };
}
