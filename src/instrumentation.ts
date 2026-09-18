export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { syncSchedulerState, startReachRefresh } = await import("@/lib/scheduler");
    await syncSchedulerState();
    // Unconditional: reachability goes stale with every decision the user
    // records, whether or not an automation is collecting anything.
    startReachRefresh();
  }
}
