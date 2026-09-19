-- Employers ruled out wholesale. A hidden company's postings keep being
-- collected -- they are still needed for dedup -- but they leave the job list.
-- The old panel kept this list in data/hidden.json; nothing on the server could
-- extend it, so switching the panel off would have frozen it at 32 employers.
ALTER TABLE "Company" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
