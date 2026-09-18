-- How precisely the moment of an application is known: "exact" | "minute" | "day".
-- Null is the normal answer for a date nobody qualified, and is NOT "exact":
-- of the applications imported from the old panel, thirteen carry only the
-- start time of the run that sent them and one carries no time at all, and
-- rendering those as a timestamp would claim a measurement nobody made.
ALTER TABLE "Job" ADD COLUMN "appliedDatePrecision" TEXT;
