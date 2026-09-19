import {
  himalayasPageUrl,
  mapHimalayasJob,
  searchHimalayasJobs,
  type HimalayasJob,
  type HimalayasPage,
} from "@/lib/scraper/himalayas";
import {
  arbeitnowPageUrl,
  mapArbeitnowJob,
  searchArbeitnowJobs,
  type ArbeitnowJob,
  type ArbeitnowPage,
} from "@/lib/scraper/arbeitnow";
import { APP_CONSTANTS } from "@/lib/constants";

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function fetchPages(pages: unknown[]) {
  let call = 0;
  return vi.spyOn(global, "fetch").mockImplementation(() => {
    const body = pages[Math.min(call, pages.length - 1)];
    call++;
    return Promise.resolve(okJson(body));
  });
}

function urlOf(spy: ReturnType<typeof fetchPages>, call: number): string {
  return String(spy.mock.calls[call][0]);
}

/* ------------------------------------------------------------- Himalayas */

// One row copied verbatim off a live response (19.09.2026), trimmed only in
// description length: the point of the fixture is the field NAMES.
const HIMALAYAS_ROW: HimalayasJob = {
  title: "Careers at Swiftly: Open Application",
  excerpt: "Swiftly is on a mission to help cities move more efficiently.",
  companyName: "Swiftly, Inc.",
  companySlug: "swiftly-inc",
  employmentType: "Full Time",
  minSalary: 150000,
  maxSalary: 190000,
  salaryPeriod: "yearly",
  currency: "USD",
  locationRestrictions: ["United States"],
  description: "<h3>Company Description</h3><div>Swiftly &amp; friends</div>",
  pubDate: 1789775053,
  applicationLink:
    "https://himalayas.app/companies/swiftly-inc/jobs/careers-at-swiftly-open-application",
  guid: "https://himalayas.app/companies/swiftly-inc/jobs/careers-at-swiftly-open-application",
};

// The feed answers 20 rows whatever `limit` asks for, so a page is 20.
function himalayasPage(cursor: string | undefined, rows = 20): HimalayasPage {
  return {
    totalCount: 101967,
    nextCursor: cursor,
    jobs: Array.from({ length: rows }, (_, i) => ({
      ...HIMALAYAS_ROW,
      title: `${HIMALAYAS_ROW.title} ${cursor ?? "end"}-${i}`,
    })),
  };
}

describe("himalayasPageUrl", () => {
  it("sends limit and omits cursor on the first page", () => {
    const url = new URL(himalayasPageUrl());
    expect(url.origin + url.pathname).toBe(APP_CONSTANTS.HIMALAYAS_BASE_URL);
    expect(url.searchParams.get("limit")).toBe(
      String(APP_CONSTANTS.HIMALAYAS_PAGE_LIMIT),
    );
    expect(url.searchParams.has("cursor")).toBe(false);
  });

  it("encodes the cursor (it is base64 and carries + and =)", () => {
    const cursor = "MjAyNi0wOS0xOFQyMzo0MToxNi42MzU0NjVafDIyNDA2NDc=";
    const url = himalayasPageUrl(cursor);
    expect(url).toContain("cursor=MjAyNi0wOS0xOFQyMzo0MToxNi42MzU0NjVafDIyNDA2NDc%3D");
    expect(new URL(url).searchParams.get("cursor")).toBe(cursor);
  });
});

describe("mapHimalayasJob", () => {
  it("reads the live field names", () => {
    const job = mapHimalayasJob(HIMALAYAS_ROW);
    expect(job.title).toBe("Careers at Swiftly: Open Application");
    expect(job.company).toBe("Swiftly, Inc.");
    expect(job.location).toBe("United States");
    expect(job.description).toContain("Swiftly & friends");
    expect(job.url).toBe(HIMALAYAS_ROW.applicationLink);
    expect(job.employmentType).toBe("Full Time");
    expect(job.isRemote).toBe(true);
  });

  it("reads pubDate as Unix seconds, not milliseconds", () => {
    const job = mapHimalayasJob(HIMALAYAS_ROW);
    expect(job.postedDate).toBe(new Date(1789775053 * 1000).toISOString());
    expect(new Date(job.postedDate!).getUTCFullYear()).toBeGreaterThan(2000);
  });

  it("empty locationRestrictions means hire from anywhere, not unknown", () => {
    const job = mapHimalayasJob({
      ...HIMALAYAS_ROW,
      locationRestrictions: [],
    });
    expect(job.location).toBe("Remote");
  });

  it("formats a pay range, and a lone bound as one number", () => {
    expect(mapHimalayasJob(HIMALAYAS_ROW).salary).toBe("150000-190000 USD yearly");
    expect(
      mapHimalayasJob({ ...HIMALAYAS_ROW, minSalary: null }).salary,
    ).toBe("190000 USD yearly");
    expect(
      mapHimalayasJob({ ...HIMALAYAS_ROW, minSalary: null, maxSalary: null })
        .salary,
    ).toBeUndefined();
  });
});

describe("searchHimalayasJobs pagination", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a full page shorter than the requested limit is not the last page", async () => {
    const spy = fetchPages([
      himalayasPage("cursor-2"),
      himalayasPage(undefined),
    ]);

    const result = await searchHimalayasJobs({ maxPages: 10 });

    // 20 rows came back against limit=100; only nextCursor may stop the loop.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.jobs).toHaveLength(40);
    expect(urlOf(spy, 0)).not.toContain("cursor=");
    expect(urlOf(spy, 1)).toContain("cursor=cursor-2");
    expect(result.errors).toEqual([]);
  });

  it("stops when the feed hands back the cursor it was given", async () => {
    const spy = fetchPages([himalayasPage("same"), himalayasPage("same")]);

    const result = await searchHimalayasJobs({ maxPages: 10 });

    // Page 1 (no cursor) then page 2 (cursor=same) — which returns `same`
    // again, so the loop would otherwise refetch it to HIMALAYAS_MAX_PAGES.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.jobs).toHaveLength(40);
  });

  it("clamps the configured page count to the board ceiling", async () => {
    // A fresh cursor every page, so only the ceiling can stop the loop.
    let call = 0;
    const spy = vi.spyOn(global, "fetch").mockImplementation(() => {
      call++;
      return Promise.resolve(okJson(himalayasPage(`cursor-${call}`)));
    });

    await searchHimalayasJobs({ maxPages: 5000 });

    expect(spy).toHaveBeenCalledTimes(APP_CONSTANTS.HIMALAYAS_MAX_PAGES);
  });

  it("reports totalCount as coverage, and null when the feed omits it", async () => {
    fetchPages([himalayasPage(undefined)]);
    const measured = await searchHimalayasJobs({ maxPages: 1 });
    expect(measured.coverage).toEqual({ fetched: 20, available: 101967 });

    vi.restoreAllMocks();
    fetchPages([{ jobs: [HIMALAYAS_ROW] }]);
    const unmeasured = await searchHimalayasJobs({ maxPages: 1 });
    expect(unmeasured.coverage).toEqual({ fetched: 1, available: null });
  });

  it("an empty job page ends the feed; a body with no jobs key is an error", async () => {
    fetchPages([{ totalCount: 101967, jobs: [] }]);
    const ended = await searchHimalayasJobs({ maxPages: 3 });
    expect(ended.jobs).toEqual([]);
    expect(ended.errors).toEqual([]);

    vi.restoreAllMocks();
    // What an interstitial parses to: a 200 with no `jobs` array at all.
    fetchPages([{ message: "just a moment" }]);
    const blocked = await searchHimalayasJobs({ maxPages: 3 });
    expect(blocked.jobs).toEqual([]);
    expect(blocked.errors).toHaveLength(1);
    expect(blocked.errors[0].token).toBe("himalayas");
  });

  it("keeps the pages it got when a later page fails", async () => {
    let call = 0;
    vi.spyOn(global, "fetch").mockImplementation(() => {
      call++;
      return Promise.resolve(
        call === 1 ? okJson(himalayasPage("cursor-2")) : okJson(null, 503),
      );
    });

    const result = await searchHimalayasJobs({ maxPages: 10 });

    expect(result.jobs).toHaveLength(20);
    expect(result.errors).toEqual([
      { token: "himalayas", reason: "page 2 returned 503" },
    ]);
  });

  it("a thrown fetch is an error entry, never a rejected run", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNRESET"));

    const result = await searchHimalayasJobs({ maxPages: 3 });

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([
      { token: "himalayas", reason: "ECONNRESET" },
    ]);
  });
});

/* ------------------------------------------------------------- Arbeitnow */

// One row copied verbatim off a live response (19.09.2026).
const ARBEITNOW_ROW: ArbeitnowJob = {
  slug: "remote-business-development-manager-eu-airport-transfers-all-genders-384565",
  company_name: "Distribusion Technologies",
  title: "Business Development Manager, EU Airport transfers (all genders)",
  description: "<p><strong>About us</strong></p><p>Distribusion &amp; co</p>",
  remote: true,
  url: "https://www.arbeitnow.com/jobs/companies/distribusion-technologies/remote-business-development-manager-eu-airport-transfers-all-genders-384565",
  tags: ["Commercial", "Remote"],
  job_types: ["Mid", "fulltime permanent"],
  location: "Remote job",
  created_at: 1789763409,
};

function arbeitnowPage(next: string | null, rows = 3): ArbeitnowPage {
  return {
    links: { next },
    data: Array.from({ length: rows }, (_, i) => ({
      ...ARBEITNOW_ROW,
      slug: `${ARBEITNOW_ROW.slug}-${next ?? "last"}-${i}`,
    })),
  };
}

describe("arbeitnowPageUrl", () => {
  it("adds visa_sponsorship only when the toggle is on", () => {
    const filtered = new URL(arbeitnowPageUrl(2, true));
    expect(filtered.origin + filtered.pathname).toBe(
      APP_CONSTANTS.ARBEITNOW_BASE_URL,
    );
    expect(filtered.searchParams.get("page")).toBe("2");
    expect(filtered.searchParams.get("visa_sponsorship")).toBe("true");

    const plain = new URL(arbeitnowPageUrl(2, false));
    expect(plain.searchParams.has("visa_sponsorship")).toBe(false);
  });
});

describe("mapArbeitnowJob", () => {
  it("reads the live field names", () => {
    const job = mapArbeitnowJob(ARBEITNOW_ROW);
    expect(job.title).toBe(
      "Business Development Manager, EU Airport transfers (all genders)",
    );
    expect(job.company).toBe("Distribusion Technologies");
    expect(job.location).toBe("Remote job");
    expect(job.description).toContain("Distribusion & co");
    expect(job.url).toBe(ARBEITNOW_ROW.url);
    expect(job.isRemote).toBe(true);
    expect(job.employmentType).toBe("Mid, fulltime permanent");
  });

  it("reads created_at as Unix seconds, not milliseconds", () => {
    const job = mapArbeitnowJob(ARBEITNOW_ROW);
    expect(job.postedDate).toBe(new Date(1789763409 * 1000).toISOString());
    expect(new Date(job.postedDate!).getUTCFullYear()).toBeGreaterThan(2000);
  });
});

describe("searchArbeitnowJobs pagination", () => {
  afterEach(() => vi.restoreAllMocks());

  it("walks its own page numbers while links.next says there is more", async () => {
    const spy = fetchPages([
      arbeitnowPage("https://www.arbeitnow.com/api/job-board-api?page=2"),
      arbeitnowPage(null),
    ]);

    const result = await searchArbeitnowJobs({
      maxPages: 10,
      visaSponsorshipOnly: true,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.jobs).toHaveLength(6);
    expect(urlOf(spy, 0)).toContain("page=1");
    expect(urlOf(spy, 1)).toContain("page=2");
    // Every page keeps the filter; the link in the body is never followed.
    expect(urlOf(spy, 1)).toContain("visa_sponsorship=true");
  });

  it("fetches the unfiltered feed when the toggle is off", async () => {
    const spy = fetchPages([arbeitnowPage(null)]);

    await searchArbeitnowJobs({ maxPages: 1, visaSponsorshipOnly: false });

    expect(urlOf(spy, 0)).not.toContain("visa_sponsorship");
  });

  it("clamps the configured page count to the board ceiling", async () => {
    const spy = fetchPages([
      arbeitnowPage("https://www.arbeitnow.com/api/job-board-api?page=2"),
    ]);

    await searchArbeitnowJobs({ maxPages: 5000 });

    expect(spy).toHaveBeenCalledTimes(APP_CONSTANTS.ARBEITNOW_MAX_PAGES);
  });

  it("never claims to know the feed's depth", async () => {
    fetchPages([arbeitnowPage(null)]);

    const result = await searchArbeitnowJobs({ maxPages: 1 });

    expect(result.coverage).toEqual({ fetched: 3, available: null });
  });

  it("an empty data page ends the feed; a body with no data key is an error", async () => {
    fetchPages([{ data: [], links: { next: null } }]);
    const ended = await searchArbeitnowJobs({ maxPages: 3 });
    expect(ended.jobs).toEqual([]);
    expect(ended.errors).toEqual([]);

    vi.restoreAllMocks();
    fetchPages([{ message: "just a moment" }]);
    const blocked = await searchArbeitnowJobs({ maxPages: 3 });
    expect(blocked.jobs).toEqual([]);
    expect(blocked.errors).toEqual([
      { token: "arbeitnow", reason: "page 1 was not a job page" },
    ]);
  });

  it("keeps the pages it got when a later page fails", async () => {
    let call = 0;
    vi.spyOn(global, "fetch").mockImplementation(() => {
      call++;
      return Promise.resolve(
        call === 1
          ? okJson(arbeitnowPage("https://www.arbeitnow.com/api/job-board-api?page=2"))
          : okJson(null, 429),
      );
    });

    const result = await searchArbeitnowJobs({ maxPages: 10 });

    expect(result.jobs).toHaveLength(3);
    expect(result.errors).toEqual([
      { token: "arbeitnow", reason: "page 2 returned 429" },
    ]);
  });

  it("a thrown fetch is an error entry, never a rejected run", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNRESET"));

    const result = await searchArbeitnowJobs({ maxPages: 3 });

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([
      { token: "arbeitnow", reason: "ECONNRESET" },
    ]);
  });
});
