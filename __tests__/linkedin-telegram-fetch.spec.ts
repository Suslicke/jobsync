// The delays these two adapters run at are real seconds — 700ms between guest
// requests, a minute before a throttled query is retried, 1.2s between channel
// pages. They are mocked to zero here so the walk logic can be tested at speed;
// the pacer's own arithmetic is tested against the real constants in
// linkedin-telegram.spec.ts.
vi.mock("@/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants")>();
  return {
    ...actual,
    APP_CONSTANTS: {
      ...actual.APP_CONSTANTS,
      LINKEDIN_GUEST_MIN_INTERVAL_MS: 0,
      LINKEDIN_GUEST_RETRY_AFTER_MS: 0,
      LINKEDIN_DESC_MIN_INTERVAL_MS: 0,
      LINKEDIN_DESC_MAX_INTERVAL_MS: 0,
      TELEGRAM_PAGE_DELAY_MS: 0,
    },
  };
});

import { APP_CONSTANTS } from "@/lib/constants";
import { hydrateLinkedInJobs, searchLinkedInJobs } from "@/lib/scraper/linkedin";
import { searchTelegramChannels } from "@/lib/scraper/telegram";
import type { JobDetails } from "@/lib/scraper/types";

function html(body: string, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
  } as Response;
}

function guestPage(ids: number[]): string {
  return ids
    .map(
      (id) =>
        `<li><div data-entity-urn="urn:li:jobPosting:${id}">` +
        `<a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/role-${id}"></a>` +
        `<h3 class="base-search-card__title">Role ${id}</h3>` +
        `<h4 class="base-search-card__subtitle"><a>Acme</a></h4>` +
        `<span class="job-search-card__location">Canada</span>` +
        `<time datetime="2026-09-16"></time></div></li>`,
    )
    .join("");
}

const range = (from: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => from + i);

const startOf = (url: string): number =>
  Number(new URL(url).searchParams.get("start"));

describe("searchLinkedInJobs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("walks pages of ten and stops once a page brings nothing new", async () => {
    // Walking past the end of a result set does not produce an empty page here:
    // the endpoint serves the same cards again.
    const spy = vi
      .spyOn(global, "fetch")
      .mockImplementation(async () => html(guestPage(range(1, 10))));

    const outcome = await searchLinkedInJobs({
      queries: ["Backend"],
      geos: ["Canada"],
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(startOf(String(spy.mock.calls[1][0]))).toBe(10);
    expect(outcome.jobs).toHaveLength(10);
    expect(outcome.errors).toEqual([]);
  });

  it("stops on an empty page without calling it a failure", async () => {
    const spy = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      return startOf(String(input)) === 0
        ? html(guestPage(range(1, 10)))
        : html("");
    });

    const outcome = await searchLinkedInJobs({
      queries: ["Backend"],
      geos: ["Canada"],
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(outcome.jobs).toHaveLength(10);
    expect(outcome.errors).toEqual([]);
  });

  it("retries a query throttled on its first page, and names it if it still will not answer", async () => {
    // A 429 on start=0 leaves the query with nothing, which is exactly what "no
    // matches" looks like in the result. It must not be left to read that way.
    vi.spyOn(global, "fetch").mockResolvedValue(html("", 429));

    const outcome = await searchLinkedInJobs({
      queries: ["Backend"],
      geos: ["Canada"],
    });

    expect(outcome.jobs).toEqual([]);
    expect(outcome.errors).toEqual([
      { token: "Backend in Canada", reason: "rate limited (retried once)" },
    ]);
  });

  it("keeps a query that answers on the retry", async () => {
    let call = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      call++;
      if (call === 1) return html("", 429);
      return html(guestPage(range(1, 10)));
    });

    const outcome = await searchLinkedInJobs({
      queries: ["Backend"],
      geos: ["Canada"],
    });

    expect(outcome.errors).toEqual([]);
    expect(outcome.jobs).toHaveLength(10);
  });

  it("reports a non-429 first-page failure without retrying it", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(html("", 500));

    const outcome = await searchLinkedInJobs({
      queries: ["Backend"],
      geos: ["Canada"],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(outcome.errors).toEqual([
      { token: "Backend in Canada", reason: "returned 500" },
    ]);
  });

  it("keeps what a query collected before being throttled mid-walk", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) =>
      startOf(String(input)) === 0
        ? html(guestPage(range(1, 10)))
        : html("", 429),
    );

    const outcome = await searchLinkedInJobs({
      queries: ["Backend"],
      geos: ["Canada"],
    });

    // Ten cards is not a failed unit, so nothing is reported.
    expect(outcome.jobs).toHaveLength(10);
    expect(outcome.errors).toEqual([]);
  });

  it("collapses a pair that only repeats another pair's results", async () => {
    // "canada" and "canada-remote" turned out to be one query; the second cost
    // a request per keyword to prove it.
    const spy = vi
      .spyOn(global, "fetch")
      .mockImplementation(async () => html(guestPage(range(1, 10))));

    const outcome = await searchLinkedInJobs({
      queries: ["Backend"],
      geos: ["Canada", "Canada, Remote"],
    });

    expect(outcome.jobs).toHaveLength(10);
    // The second pair stops on its first page instead of walking forty.
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("reports coverage with an unknown depth as null", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(html(guestPage(range(1, 10))));

    const outcome = await searchLinkedInJobs({
      queries: ["Backend"],
      geos: ["Canada"],
    });

    // The fragment never says how many postings a search has. Unknown is null.
    expect(outcome.coverage).toEqual({ fetched: 10, available: null });
  });

  it("stops at the page ceiling when every page is new", async () => {
    let id = 0;
    const spy = vi.spyOn(global, "fetch").mockImplementation(async () => {
      id += 10;
      return html(guestPage(range(id, 10)));
    });

    const outcome = await searchLinkedInJobs({
      queries: ["Backend"],
      geos: ["Canada"],
    });

    expect(spy).toHaveBeenCalledTimes(APP_CONSTANTS.LINKEDIN_GUEST_MAX_PAGES);
    expect(outcome.jobs).toHaveLength(
      APP_CONSTANTS.LINKEDIN_GUEST_MAX_PAGES * 10,
    );
  });
});

const POSTING = (body: string, employment = "Full-time"): string =>
  `<div class="show-more-less-html__markup">${body}</div>
   <li><h3 class="description__job-criteria-subheader">Employment type</h3>
   <span class="description__job-criteria-text">${employment}</span></li>`;

const card = (overrides: Partial<JobDetails> = {}): JobDetails => ({
  title: "Role 1",
  company: "Acme",
  location: "Canada",
  description: "",
  url: "https://www.linkedin.com/jobs/view/role-4390721897",
  ...overrides,
});

describe("hydrateLinkedInJobs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fills the description and employment type the card never carried", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(html(POSTING("<p>Python and FastAPI</p>")));

    const [job] = await hydrateLinkedInJobs([card()]);

    expect(String(spy.mock.calls[0][0])).toBe(
      `${APP_CONSTANTS.LINKEDIN_DESC_BASE_URL}/4390721897`,
    );
    expect(job.description).toBe("<p>Python and FastAPI</p>");
    expect(job.employmentType).toBe("Full-time");
  });

  it("leaves out a posting that was withdrawn", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(html("", 404));
    // The runner matches what comes back by URL, so a short array is expected.
    expect(await hydrateLinkedInJobs([card()])).toEqual([]);
  });

  it("leaves out a fragment that yielded no body at all", async () => {
    // Counting this one would be the "ok 20" report over twenty blank
    // descriptions: the pass says it loaded details it did not load.
    vi.spyOn(global, "fetch").mockResolvedValue(html("<div></div>"));
    expect(await hydrateLinkedInJobs([card()])).toEqual([]);
  });

  it("gives up on a posting that keeps being throttled", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(html("", 429));
    expect(await hydrateLinkedInJobs([card()])).toEqual([]);
    expect(spy.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not fetch for a job whose URL holds no posting id", async () => {
    const spy = vi.spyOn(global, "fetch");
    expect(
      await hydrateLinkedInJobs([card({ url: "https://example.com/careers" })]),
    ).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

function previewPage(channel: string, ids: number[]): string {
  return ids
    .map(
      (id) =>
        `<div data-post="${channel}/${id}">` +
        `<div class="tgme_widget_message_text js-message_text">Backend Engineer ${id} в Acme</div>` +
        `<time datetime="2026-09-03T05:00:03+00:00"></time></div>`,
    )
    .join("");
}

const beforeOf = (url: string): string | null =>
  new URL(url).searchParams.get("before");

describe("searchTelegramChannels", () => {
  afterEach(() => vi.restoreAllMocks());

  it("walks backwards with `before` and stops when the page does not move", async () => {
    // Asking for a `before` older than the channel's first message returns the
    // same page again rather than an empty one.
    const spy = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const before = beforeOf(String(input));
      if (before === null) return html(previewPage("ch", [100, 99, 98]));
      return html(previewPage("ch", [97, 96, 95]));
    });

    const outcome = await searchTelegramChannels({ channels: ["ch"] });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(beforeOf(String(spy.mock.calls[1][0]))).toBe("98");
    expect(beforeOf(String(spy.mock.calls[2][0]))).toBe("95");
    expect(outcome.jobs).toHaveLength(6);
  });

  it("a dead channel costs its own rows and nothing else", async () => {
    // it_match_python went invite-only and the preview answers 404. One dead
    // channel must never abort the run.
    vi.spyOn(global, "fetch").mockImplementation(async (input) =>
      String(input).includes("gone")
        ? html("", 404)
        : html(previewPage("alive", [10])),
    );

    const outcome = await searchTelegramChannels({
      channels: ["gone", "alive"],
    });

    expect(outcome.errors).toEqual([{ token: "gone", reason: "returned 404" }]);
    expect(outcome.jobs).toHaveLength(1);
  });

  it("does not let one channel's message id swallow another's", async () => {
    // Message ids restart per channel, so a run-wide set of bare numbers would
    // drop the second channel's post 10 as a duplicate.
    vi.spyOn(global, "fetch").mockImplementation(async (input) =>
      html(previewPage(String(input).includes("/a") ? "a" : "b", [10])),
    );

    const outcome = await searchTelegramChannels({ channels: ["a", "b"] });

    expect(outcome.jobs.map((j) => j.url)).toEqual([
      "https://t.me/a/10",
      "https://t.me/b/10",
    ]);
  });
});

// Until search() took a signal, Cancel was decorative for the length of the
// sweep: the /cancel route flipped the run row to 'cancelling', runner.ts's
// 500 ms poll aborted the controller, the UI said "cancelling" — and the
// process kept asking LinkedIn for pages until the whole walk finished, up to
// half an hour later, because the runner's first `aborted` check came after
// search() returned.
describe("cancelling a sweep", () => {
  it("stops LinkedIn between pages instead of after the last one", async () => {
    const controller = new AbortController();
    const spy = vi.spyOn(global, "fetch").mockImplementation(async () => {
      controller.abort();
      return html(guestPage([1, 2, 3]));
    });

    const outcome = await searchLinkedInJobs(
      { queries: ["python", "backend"], geos: ["Canada", "Germany"] },
      controller.signal,
    );

    // One request: the first page of the first pair. Without the check the four
    // pairs would have walked on regardless.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(outcome.jobs).toHaveLength(3);
  });

  it("does not open the next Telegram channel once cancelled", async () => {
    const controller = new AbortController();
    const spy = vi.spyOn(global, "fetch").mockImplementation(async () => {
      controller.abort();
      return html(previewPage("a", [10]));
    });

    await searchTelegramChannels(
      { channels: ["a", "b", "c"] },
      controller.signal,
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
