import { APP_CONSTANTS } from "@/lib/constants";

// LinkedIn's guest endpoints take no cookie, so the quota is per IP address and
// it is spent on SPEED rather than volume. Measured 02.09.2026 and unchanged
// 19.09.2026: one stream at 1.47 req/s finished 60 requests without a single
// 429, three streams at 5.26 req/s took one at request 27. The bucket is about
// thirty deep and it is the burst that empties it, not the total.
//
// The search sweep and the description pass reach the same host from the same
// address, so they share ONE pacer. Two independent limiters, each politely
// under the threshold on its own, add up to a rate that is not.
export class GuestPacer {
  // Annotated, because APP_CONSTANTS is `as const` and the inferred type would
  // be the literal 700 — every widening assignment below would be an error.
  private interval: number = APP_CONSTANTS.LINKEDIN_GUEST_MIN_INTERVAL_MS;
  // When the next request may go out, as a timestamp rather than a lock: a
  // caller reserves its slot before awaiting, so several callers queue in the
  // order they arrived instead of all waking on the same interval.
  private next = 0;

  async take(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.interval;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  // LinkedIn sends no Retry-After with its 429, so the wait is the client's to
  // choose. Doubling is the multiplicative half of AIMD and, unlike a fixed
  // sleep, it keeps growing while the source keeps refusing.
  penalise(): void {
    this.interval = Math.min(
      APP_CONSTANTS.LINKEDIN_DESC_MAX_INTERVAL_MS,
      this.interval * 2,
    );
    this.next = Date.now() + this.interval;
  }

  // Recovery is additive, one floor-step per good response, so a single 200
  // cannot undo a backoff the source just asked for.
  recover(): void {
    this.interval = Math.max(
      APP_CONSTANTS.LINKEDIN_GUEST_MIN_INTERVAL_MS,
      this.interval - APP_CONSTANTS.LINKEDIN_GUEST_MIN_INTERVAL_MS,
    );
  }

  get intervalMs(): number {
    return this.interval;
  }
}

// Module-level on purpose: the bucket belongs to the address, not to a run, so
// a second automation starting while the first is being throttled must inherit
// the backoff instead of resetting it.
export const linkedInPacer = new GuestPacer();
