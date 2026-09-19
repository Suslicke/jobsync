-- Proof that a run is still working, as opposed to proof that it started a
-- while ago. reapStaleRuns flipped any run older than the stale cutoff out of
-- 'running' — and 'running' is one of the two statuses the single-active
-- partial index covers (20260710000001_automation_run_single_active), so a
-- live run that was reaped no longer blocked a second run of the same
-- automation. Null on every row written before this column existed; the reaper
-- falls back to startedAt for those.
ALTER TABLE "AutomationRun" ADD COLUMN "lastProgressAt" DATETIME;
