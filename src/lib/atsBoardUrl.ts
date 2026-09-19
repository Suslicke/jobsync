import { boardById } from "@/lib/scraper/boards";
import type { JobBoard, LeverHost } from "@/models/automation.model";

// Public job-board URL for a company, read off the board table rather than an
// if-chain here: the chain was one of eleven places a board had to be named,
// and its fall-through silently returned a Greenhouse URL for anything it did
// not recognise.
export function companyBoardUrl(
  jobBoard: JobBoard,
  company: { token: string; host?: LeverHost },
): string {
  return boardById(jobBoard)?.boardUrl?.(company) ?? "";
}
