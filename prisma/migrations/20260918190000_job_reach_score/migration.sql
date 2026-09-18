-- How reachable a posting is, and which terms made that number.
-- A scalar column because the list sorts in SQL and the inputs (a JSON string
-- in fitData, a per-user taste aggregate) are not orderable from there.
ALTER TABLE "Job" ADD COLUMN "reachScore" REAL;
ALTER TABLE "Job" ADD COLUMN "reachData" TEXT;
CREATE INDEX "Job_userId_reachScore_idx" ON "Job"("userId", "reachScore");
