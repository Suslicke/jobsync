"use client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { ArrowDown, ArrowUp, ChevronsUpDown, StickyNote } from "lucide-react";
import { Badge } from "../ui/badge";
import { format } from "date-fns";
import { useState } from "react";
import {
  JobResponse,
  JobStatus,
  type JobSort,
  type JobSortField,
} from "@/models/job.model";
import Link from "next/link";
import { DeleteAlertDialog } from "../DeleteAlertDialog";
import { CircularScore } from "@/components/CircularScore";
import { JobStatusBadgeMenu } from "./JobStatusBadgeMenu";
import { TooltipProvider } from "../ui/tooltip";
import { JobActionsMenu } from "./JobActionsMenu";
import { MatchJobButton } from "./MatchJobButton";
import { CompanyLogo } from "./CompanyLogo";
import { FitBadges } from "./FitBadges";
import { ReachBadge } from "./ReachBadge";

type MyJobsTableProps = {
  jobs: JobResponse[];
  sort?: JobSort[];
  onToggleSort?: (field: JobSortField, additive?: boolean) => void;
  jobStatuses: JobStatus[];
  deleteJob: (id: string) => void;
  editJob: (id: string) => void;
  onChangeJobStatus: (id: string, status: JobStatus) => void;
  onAddNote: (jobId: string) => void;
  onFeedback?: (job: JobResponse, kind: "applied" | "passed") => void;
};

function MyJobsTable({
  jobs,
  sort = [],
  onToggleSort,
  jobStatuses,
  deleteJob,
  editJob,
  onChangeJobStatus,
  onAddNote,
  onFeedback,
}: MyJobsTableProps) {
  const [alertOpen, setAlertOpen] = useState(false);
  const [jobIdToDelete, setJobIdToDelete] = useState("");

  // Header cell that sorts. Plain click sorts by this column alone;
  // shift-click (or cmd/ctrl-click) appends it after the columns already chosen,
  // so several columns can sort at once. The badge shows that order.
  const SortableHead = ({
    field,
    className,
    children,
  }: {
    field: JobSortField;
    className?: string;
    children: React.ReactNode;
  }) => {
    const index = sort.findIndex((s) => s.field === field);
    const active = index >= 0 ? sort[index] : undefined;
    return (
      <TableHead className={className}>
        <button
          type="button"
          onClick={(e) => onToggleSort?.(field, e.shiftKey || e.metaKey || e.ctrlKey)}
          className="inline-flex items-center gap-1 hover:text-foreground"
          title="Click to sort; shift-click to add another column"
        >
          {children}
          {active ? (
            <>
              {active.dir === "asc" ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {sort.length > 1 && (
                <span className="text-[10px] text-muted-foreground">{index + 1}</span>
              )}
            </>
          ) : (
            <ChevronsUpDown className="h-3 w-3 opacity-30" />
          )}
        </button>
      </TableHead>
    );
  };

  const onDeleteJob = (jobId: string) => {
    setAlertOpen(true);
    setJobIdToDelete(jobId);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden w-[100px] sm:table-cell">
              <span className="sr-only">Company Logo</span>
            </TableHead>
            <SortableHead field="appliedDate" className="hidden md:table-cell">Date Applied</SortableHead>
            <SortableHead field="title">Title</SortableHead>
            <SortableHead field="company">Company</SortableHead>
            <SortableHead field="location" className="hidden md:table-cell">Location</SortableHead>
            <SortableHead field="status">Status</SortableHead>
            <SortableHead field="matchScore" className="hidden md:table-cell text-center">Match</SortableHead>
            <SortableHead field="reach" className="hidden lg:table-cell text-center">Reach</SortableHead>
            <SortableHead field="source" className="hidden md:table-cell">Source</SortableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job: JobResponse) => {
            return (
              <TableRow key={job.id}>
                <TableCell className="hidden sm:table-cell">
                  <CompanyLogo
                    logoUrl={job.Company?.logoUrl}
                    className="h-8 w-8 min-w-8"
                  />
                </TableCell>
                <TableCell className="hidden md:table-cell w-[120px] whitespace-nowrap">
                  {job.appliedDate ? format(job.appliedDate, "PP") : "N/A"}
                </TableCell>
                <TableCell
                  className="font-medium cursor-pointer max-w-[120px] md:max-w-[220px]"
                >
                  <div className="flex items-center gap-1.5">
                    <Link href={`/dashboard/myjobs/${job?.id}`} className="block truncate">
                      {job.JobTitle?.label}
                    </Link>
                    {(job._count?.Notes ?? 0) > 0 && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 shrink-0">
                        <StickyNote className="h-3 w-3 mr-0.5" />
                        {job._count!.Notes}
                      </Badge>
                    )}
                  </div>
                  <FitBadges fitData={job.fitData} className="mt-1" />
                </TableCell>
                <TableCell className="font-medium max-w-[100px] md:max-w-[160px]">
                  <span className="block truncate">{job.Company?.label}</span>
                </TableCell>
                <TableCell className="hidden md:table-cell whitespace-nowrap max-w-[120px]">
                  <span className="block truncate">{job.Location?.label}</span>
                </TableCell>
                <TableCell>
                  <JobStatusBadgeMenu
                    job={job}
                    jobStatuses={jobStatuses}
                    onChangeJobStatus={onChangeJobStatus}
                    className="w-[110px] whitespace-nowrap justify-center"
                  />
                </TableCell>
                <TableCell className="hidden md:table-cell text-center">
                  {job.matchScore != null ? (
                    <CircularScore
                      score={job.matchScore}
                      size="sm"
                      animate={false}
                      className="mx-auto"
                    />
                  ) : (
                    <MatchJobButton jobId={job.id} />
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-center">
                  <ReachBadge reachScore={job.reachScore} reachData={job.reachData} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {job.JobSource?.label}
                </TableCell>
                <TableCell>
                  <JobActionsMenu
                    job={job}
                    jobStatuses={jobStatuses}
                    editJob={editJob}
                    onChangeJobStatus={onChangeJobStatus}
                    onAddNote={onAddNote}
                    onFeedback={onFeedback}
                    onDeleteJob={onDeleteJob}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <DeleteAlertDialog
        pageTitle="job"
        open={alertOpen}
        onOpenChange={setAlertOpen}
        onDelete={() => deleteJob(jobIdToDelete)}
      />
    </TooltipProvider>
  );
}

export default MyJobsTable;
