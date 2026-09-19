import {
  boardSlugFrom,
  delay,
  dedupeJobs,
  humanizeToken,
  jobDedupeKey,
  jobDedupeKeys,
  loopFailure,
  normalizeJobUrl,
  runDeadline,
} from "@/lib/scraper/utils";

describe("normalizeJobUrl", () => {
  it("removes utm_source parameter", () => {
    const url = "https://example.com/job?utm_source=google&id=123";
    expect(normalizeJobUrl(url)).toBe("https://example.com/job?id=123");
  });

  it("removes all UTM parameters", () => {
    const url =
      "https://example.com/job?utm_source=x&utm_medium=y&utm_campaign=z&utm_term=a&utm_content=b&id=1";
    expect(normalizeJobUrl(url)).toBe("https://example.com/job?id=1");
  });

  it("removes fbclid parameter", () => {
    const url = "https://example.com/job?fbclid=abc123&title=dev";
    expect(normalizeJobUrl(url)).toBe("https://example.com/job?title=dev");
  });

  it("removes gclid parameter", () => {
    const url = "https://example.com/job?gclid=xyz&role=swe";
    expect(normalizeJobUrl(url)).toBe("https://example.com/job?role=swe");
  });

  it("removes msclkid parameter", () => {
    const url = "https://example.com/job?msclkid=abc&id=5";
    expect(normalizeJobUrl(url)).toBe("https://example.com/job?id=5");
  });

  it("removes ref, source, tk, from, vjk parameters", () => {
    const url =
      "https://example.com/job?ref=email&source=board&tk=abc&from=search&vjk=xyz&id=1";
    expect(normalizeJobUrl(url)).toBe("https://example.com/job?id=1");
  });

  it("returns clean URL when all params are tracking", () => {
    const url = "https://example.com/job?utm_source=google&fbclid=abc";
    expect(normalizeJobUrl(url)).toBe("https://example.com/job");
  });

  it("preserves non-tracking parameters", () => {
    const url = "https://example.com/job?id=123&position=dev";
    expect(normalizeJobUrl(url)).toBe(
      "https://example.com/job?id=123&position=dev"
    );
  });

  it("preserves URL path and hash", () => {
    const url = "https://example.com/jobs/123#details?utm_source=x";
    const result = normalizeJobUrl(url);
    expect(result).toContain("/jobs/123");
  });

  it("returns original string for invalid URLs", () => {
    const invalid = "not-a-valid-url";
    expect(normalizeJobUrl(invalid)).toBe(invalid);
  });

  it("handles URL with no query parameters", () => {
    const url = "https://example.com/job/123";
    expect(normalizeJobUrl(url)).toBe("https://example.com/job/123");
  });

  it("removes the greenhouse gh_src tracking param but keeps gh_jid", () => {
    const url =
      "https://boards.greenhouse.io/acme/jobs/123?gh_src=abc&gh_jid=123";
    expect(normalizeJobUrl(url)).toBe(
      "https://boards.greenhouse.io/acme/jobs/123?gh_jid=123"
    );
  });

  it("strips a trailing slash from the path", () => {
    expect(normalizeJobUrl("https://example.com/jobs/123/")).toBe(
      "https://example.com/jobs/123"
    );
  });

  it("sorts query params so order does not matter", () => {
    expect(normalizeJobUrl("https://example.com/job?b=2&a=1")).toBe(
      "https://example.com/job?a=1&b=2"
    );
  });
});

describe("jobDedupeKey", () => {
  it("treats trailing slash, host case, and www as the same job", () => {
    const a = jobDedupeKey({ url: "https://www.example.com/jobs/1/" });
    const b = jobDedupeKey({ url: "https://Example.com/jobs/1" });
    expect(a).toBe(b);
  });

  it("treats differing tracking params as the same job", () => {
    const a = jobDedupeKey({ url: "https://ex.com/j/1?gh_src=x&gh_jid=1" });
    const b = jobDedupeKey({ url: "https://ex.com/j/1?gh_src=y&gh_jid=1" });
    expect(a).toBe(b);
  });

  it("falls back to a title/company/location key when url is missing", () => {
    const a = jobDedupeKey({
      title: "Software Engineer",
      company: "Acme",
      location: "Remote",
    });
    const b = jobDedupeKey({
      title: "Software Engineer",
      company: "Acme",
      location: "Remote",
    });
    expect(a).toBe(b);
    expect(a.startsWith("meta:")).toBe(true);
  });

  it("distinguishes different linkless jobs", () => {
    const a = jobDedupeKey({ title: "Engineer", company: "Acme" });
    const b = jobDedupeKey({ title: "Designer", company: "Acme" });
    expect(a).not.toBe(b);
  });

  it("folds a company legal suffix, matching resolveCompany's canonical value", () => {
    const a = jobDedupeKey({ title: "Engineer", company: "Acme Inc." });
    const b = jobDedupeKey({ title: "Engineer", company: "Acme" });
    expect(a).toBe(b);
  });

  it("folds diacritics in the meta key, matching entity resolution", () => {
    const a = jobDedupeKey({ title: "Engineer", company: "Acme", location: "São Paulo" });
    const b = jobDedupeKey({ title: "Engineer", company: "Acme", location: "Sao Paulo" });
    expect(a).toBe(b);
  });
});

describe("dedupeJobs", () => {
  it("removes duplicates within the batch", () => {
    const jobs = [
      { title: "A", company: "X", location: "R", url: "https://ex.com/1" },
      { title: "A", company: "X", location: "R", url: "https://ex.com/1?ref=y" },
    ];
    expect(dedupeJobs(jobs, new Set())).toHaveLength(1);
  });

  it("removes jobs already saved (existing keys)", () => {
    const jobs = [
      { title: "A", company: "X", location: "R", url: "https://ex.com/1" },
    ];
    const existing = new Set([jobDedupeKey(jobs[0])]);
    expect(dedupeJobs(jobs, existing)).toHaveLength(0);
  });

  it("dedups linkless jobs by metadata", () => {
    const jobs = [
      { title: "A", company: "X", location: "R", url: "" },
      { title: "A", company: "X", location: "R", url: "" },
      { title: "B", company: "X", location: "R", url: "" },
    ];
    expect(dedupeJobs(jobs, new Set())).toHaveLength(2);
  });

  it("keeps genuinely distinct jobs", () => {
    const jobs = [
      { title: "A", company: "X", location: "R", url: "https://ex.com/1" },
      { title: "B", company: "Y", location: "R", url: "https://ex.com/2" },
    ];
    expect(dedupeJobs(jobs, new Set())).toHaveLength(2);
  });
});

describe("jobDedupeKeys (cross-source identity)", () => {
  const onGreenhouse = {
    title: "Senior Backend Engineer",
    company: "Acme",
    location: "Berlin",
    url: "https://boards.greenhouse.io/acme/jobs/5566778",
  };
  const onLinkedIn = {
    title: "Senior Backend Engineer",
    company: "Acme",
    location: "Remote",
    url: "https://www.linkedin.com/jobs/view/4012345678",
  };

  it("collapses one opening arriving from two different boards", () => {
    expect(dedupeJobs([onLinkedIn, onGreenhouse], new Set())).toHaveLength(1);
  });

  it("recognises a saved job when the same role arrives under another URL", () => {
    const existing = new Set(jobDedupeKeys(onGreenhouse));
    expect(dedupeJobs([onLinkedIn], existing)).toHaveLength(0);
  });

  it("still emits the URL key, so URL-only lookups keep working", () => {
    expect(jobDedupeKeys(onGreenhouse)).toContain(jobDedupeKey(onGreenhouse));
  });

  it("keeps Affirm's two Backend teams apart", () => {
    const lakehouse = {
      title: "Backend (Lakehouse)",
      company: "Affirm",
      url: "https://ex.com/1",
    };
    const batch = {
      title: "Backend (Batch)",
      company: "Affirm",
      url: "https://ex.com/2",
    };
    expect(dedupeJobs([lakehouse, batch], new Set())).toHaveLength(2);
  });

  it("keeps Gitlab's Backend and Senior Backend apart", () => {
    const mid = {
      title: "Backend Engineer",
      company: "Gitlab",
      url: "https://ex.com/1",
    };
    const senior = {
      title: "Senior Backend Engineer",
      company: "Gitlab",
      url: "https://ex.com/2",
    };
    expect(dedupeJobs([mid, senior], new Set())).toHaveLength(2);
  });

  it("emits NO role key when the company could not be parsed", () => {
    // A Telegram post whose company no parser found. Without this guard two
    // different employers advertising the same title collapse into one row.
    const keys = jobDedupeKeys({
      title: "Senior Backend Engineer",
      company: "",
      url: "https://t.me/job_python/1",
    });
    expect(keys.some((k) => k.startsWith("role:"))).toBe(false);
  });

  it("keeps two companyless posts with the same title apart", () => {
    const a = { title: "Senior Backend Engineer", company: "", url: "https://t.me/a/1" };
    const b = { title: "Senior Backend Engineer", company: "", url: "https://t.me/b/2" };
    expect(dedupeJobs([a, b], new Set())).toHaveLength(2);
  });

  it("emits no role key when the title is empty", () => {
    const keys = jobDedupeKeys({ title: "", company: "Acme", url: "https://ex.com/1" });
    expect(keys.some((k) => k.startsWith("role:"))).toBe(false);
  });
});

// Sixteen adapters wrote the controller/setTimeout/clearTimeout trio by hand and
// none of them could see the run's own cancel, because search() took no signal:
// a cancelled LinkedIn sweep went on fetching until the whole walk finished.
describe("runDeadline", () => {
  it("aborts when the run is cancelled, without waiting for the deadline", () => {
    const controller = new AbortController();
    const deadline = runDeadline(60_000, controller.signal);

    expect(deadline.signal.aborted).toBe(false);
    controller.abort();
    expect(deadline.signal.aborted).toBe(true);
    deadline.release();
  });

  it("starts aborted when the run was already cancelled", () => {
    expect(runDeadline(60_000, AbortSignal.abort()).signal.aborted).toBe(true);
  });

  it("aborts on its own deadline with no run signal at all", async () => {
    const deadline = runDeadline(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(deadline.signal.aborted).toBe(true);
    deadline.release();
  });

  // The run signal outlives every request made under it, so a 40-page walk that
  // only cleared its timer would leave forty dead listeners attached to it.
  it("detaches from the run signal on release", () => {
    const controller = new AbortController();
    const deadline = runDeadline(60_000, controller.signal);
    deadline.release();
    controller.abort();
    expect(deadline.signal.aborted).toBe(false);
  });
});

describe("delay", () => {
  it("wakes early on a cancel instead of serving out the pause", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const waited = delay(60_000, controller.signal);
    controller.abort();
    await waited;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("returns at once when the run is already cancelled", async () => {
    await delay(60_000, AbortSignal.abort());
  });
});

// A cancel and a blown deadline both arrive as an AbortError, and reporting a
// cancel as "timed out after 40 jobs" sends the next reader hunting a network
// fault that never happened.
describe("loopFailure", () => {
  const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });

  it("names a cancel as a cancel", () => {
    expect(loopFailure(aborted, 40, AbortSignal.abort())).toBe(
      "cancelled after 40 jobs",
    );
  });

  it("names a deadline as a timeout", () => {
    expect(loopFailure(aborted, 40)).toBe("timed out after 40 jobs");
  });

  it("passes any other failure through in its own words", () => {
    expect(loopFailure(new Error("ECONNRESET"), 0)).toBe("ECONNRESET");
    expect(loopFailure("something", 0)).toBe("Unknown error");
  });
});

describe("boardSlugFrom", () => {
  const rippling = /ats\.rippling\.com\/([a-z0-9_-]+)/i;

  it("takes the slug out of a board link and a deep posting link", () => {
    expect(boardSlugFrom("https://ats.rippling.com/chess/jobs", rippling)).toBe(
      "chess",
    );
    expect(boardSlugFrom("ats.rippling.com/chess", rippling)).toBe("chess");
  });

  it("accepts a bare slug", () => {
    expect(boardSlugFrom("  chess  ", rippling)).toBe("chess");
  });

  // Without this another board's link would be read as a slug, interpolated
  // into this board's URL and reported as a board that does not exist.
  it("refuses a URL belonging to another board", () => {
    expect(boardSlugFrom("https://jobs.ashbyhq.com/ramp", rippling)).toBeNull();
    expect(boardSlugFrom("Chess.com", rippling)).toBeNull();
    expect(boardSlugFrom("", rippling)).toBeNull();
  });
});

describe("humanizeToken", () => {
  it("is a last resort, not a name", () => {
    expect(humanizeToken("acme-labs")).toBe("Acme Labs");
    // 'chess' is Chess.com; only the board's own payload can say so.
    expect(humanizeToken("chess")).toBe("Chess");
  });
});
