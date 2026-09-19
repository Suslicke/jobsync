// Not a "use server" module: shared across src/actions/automation/ modules,
// so it must stay importable without becoming a callable server-action endpoint.

import db from "@/lib/db";
import { APP_CONSTANTS } from "@/lib/constants";

export function formatError(
  error: unknown,
  fallback: string,
): { success: false; message: string } {
  console.error(error, fallback);
  if (error instanceof Error) {
    return { success: false, message: error.message || fallback };
  }
  return { success: false, message: fallback };
}

// One automation per hour per user used to be the rule, hand-copied into
// create, update and the MCP add tool. Sixteen boards cannot be configured
// under it, and it was never what kept runs from piling up — runDueAutomations
// is a sequential awaited loop, so automations sharing an hour already run one
// after another. A per-hour cap replaces it, in one place: a fourth copy of
// the check would have been worse than the refactor.
//
// Still application-level check-then-act, unlike the AutomationRun claim's
// partial unique index. That race is pre-existing and out of scope here.
export async function assertScheduleCapacity(
  userId: string,
  scheduleHour: number,
  excludeId?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const total = await db.automation.count({
    where: { userId, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (total >= APP_CONSTANTS.MAX_AUTOMATIONS_PER_USER) {
    return {
      ok: false,
      message: `Maximum of ${APP_CONSTANTS.MAX_AUTOMATIONS_PER_USER} automations allowed per user`,
    };
  }

  const atHour = await db.automation.count({
    where: {
      userId,
      scheduleHour,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (atHour >= APP_CONSTANTS.AUTOMATIONS_PER_HOUR_MAX) {
    return {
      ok: false,
      message: `${APP_CONSTANTS.AUTOMATIONS_PER_HOUR_MAX} automations already run at ${scheduleHour
        .toString()
        .padStart(2, "0")}:00. Please choose a different time.`,
    };
  }

  return { ok: true };
}
