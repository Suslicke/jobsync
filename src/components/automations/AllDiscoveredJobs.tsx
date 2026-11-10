"use client";

import { useEffect, useState } from "react";
import { DiscoveredJobsList } from "./DiscoveredJobsList";
import { DiscoveredJobDetail } from "./DiscoveredJobDetail";
import { useDiscoveredJobs } from "./discovered-jobs-list/useDiscoveredJobs";
import { useDiscoveredJobDetail } from "./automation-detail-container/useDiscoveredJobDetail";
import Loading from "@/components/Loading";

// Everything every automation found, in one list. With eleven automations the
// pile was only readable one page at a time, and "what is new since yesterday"
// meant opening each of them.
export function AllDiscoveredJobs({
  automations,
}: {
  automations: { id: string; name: string }[];
}) {
  const {
    jobs,
    totalJobs,
    jobsLoadingMore,
    jobStatusCounts,
    query,
    setQuery,
    refreshJobs,
    loadMoreJobs,
  } = useDiscoveredJobs();
  const {
    selectedJob,
    selectedJobMatchData,
    detailOpen,
    setDetailOpen,
    handleViewJobDetails,
  } = useDiscoveredJobDetail();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshJobs().finally(() => setLoading(false));
  }, [refreshJobs]);

  if (loading) return <Loading />;

  return (
    <>
      <DiscoveredJobsList
        jobs={jobs}
        totalJobs={totalJobs}
        loadingMore={jobsLoadingMore}
        onLoadMore={loadMoreJobs}
        dismissedCount={jobStatusCounts.dismissed}
        newCount={jobStatusCounts.new}
        acceptedCount={jobStatusCounts.accepted}
        query={query}
        onQueryChange={setQuery}
        automations={automations}
        onRefresh={refreshJobs}
        onViewDetails={handleViewJobDetails}
      />
      <DiscoveredJobDetail
        job={selectedJob}
        matchData={selectedJobMatchData}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onRefresh={refreshJobs}
      />
    </>
  );
}
