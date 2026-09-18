-- Why a job was applied to or passed over.
CREATE TABLE "JobFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "how" TEXT,
    "liked" TEXT NOT NULL DEFAULT '[]',
    "disliked" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobFeedback_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "JobFeedback_jobId_idx" ON "JobFeedback"("jobId");
CREATE INDEX "JobFeedback_kind_idx" ON "JobFeedback"("kind");
