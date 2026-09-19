import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "../types";
import type { SearchOutcome } from "../ats/types";
import { delay, runDeadline } from "../utils";
import { channelPageUrl, parseChannelPage, parsePost } from "./parse";

// Public Telegram channels through t.me/s/<channel>, the web preview: plain
// HTML, no bot token, no login, no rate limit published anywhere. Twenty
// messages a page and ?before=<id> walks backwards through the history.
//
// This is the only source in the pool where a human chose the postings, so the
// noise is low — but there is no structured data of any kind behind it. Title,
// company and location exist only because three hand-written parsers recognise
// three ways of laying out a post, and a channel that writes a fourth way
// yields nothing. That is the boundary of the method, not a bug in it.

async function fetchChannelPage(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const deadline = runDeadline(APP_CONSTANTS.TELEGRAM_FETCH_TIMEOUT_MS, signal);
  try {
    const res = await fetch(url, { signal: deadline.signal });
    if (!res.ok) throw new Error(`returned ${res.status}`);
    return await res.text();
  } finally {
    deadline.release();
  }
}

async function collectChannel(
  channel: string,
  jobs: JobDetails[],
  seen: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  let before = 0;
  for (let page = 0; page < APP_CONSTANTS.TELEGRAM_MAX_PAGES; page++) {
    // 25 channels x 10 pages at a 1.2 s delay is a walk of several minutes, so
    // a cancel has to land here rather than when the last channel finishes.
    if (signal?.aborted) return;

    const html = await fetchChannelPage(channelPageUrl(channel, before), signal);
    const posts = parseChannelPage(html);
    if (posts.length === 0) break;

    for (const post of posts) {
      // Keyed by channel AND id: message ids restart per channel, so a run-wide
      // set of bare numbers has one channel's post 500 silently swallow
      // another's.
      const key = `${channel}/${post.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const job = parsePost(post, channel);
      if (job) jobs.push(job);
    }

    // The preview answers a `before` older than the channel's first message
    // with the same page again rather than an empty one, so the end of the
    // history is a page that did not move.
    const oldest = Math.min(...posts.map((p) => p.id));
    if (before > 0 && oldest >= before) break;
    before = oldest;

    await delay(APP_CONSTANTS.TELEGRAM_PAGE_DELAY_MS, signal);
  }
}

export async function searchTelegramChannels(
  config: {
    channels: string[];
  },
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const jobs: JobDetails[] = [];
  const errors: { token: string; reason: string }[] = [];
  const seen = new Set<string>();

  // Sequential, and one try/catch per channel. A channel that went invite-only
  // answers 404 from the preview — it_match_python did exactly that — and one
  // dead channel must cost its own rows and nothing else.
  for (const channel of config.channels) {
    if (signal?.aborted) break;
    try {
      await collectChannel(channel, jobs, seen, signal);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      errors.push({ token: channel, reason });
    }
  }

  return {
    jobs,
    errors,
    // A channel never says how many job posts its history holds, and the walk
    // stops at TELEGRAM_MAX_PAGES besides. Unknown depth is null, not zero.
    coverage: { fetched: jobs.length, available: null },
  };
}
