import {
  mapRemotiveJob,
  searchRemotiveJobs,
  type RemotiveJob,
} from "@/lib/scraper/remotive";
import {
  mapWorkingNomadsJob,
  searchWorkingNomadsJobs,
  workingNomadsUrl,
  type WorkingNomadsJob,
} from "@/lib/scraper/workingnomads";
import {
  hydrateJobspressoJobs,
  jobspressoPageBody,
  parseJobspressoDescription,
  parseJobspressoListings,
  searchJobspressoJobs,
} from "@/lib/scraper/jobspresso";
import {
  hydrateRemotecomJobs,
  mapRemotecomJob,
  remotecomJobUrl,
  remotecomLocation,
  remotecomPageUrl,
  remotecomSalary,
  searchRemotecomJobs,
  type RemotecomJob,
} from "@/lib/scraper/remotecom";
import { APP_CONSTANTS } from "@/lib/constants";
import type { JobDetails } from "@/lib/scraper/types";

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/* ------------------------------------------------------------- Remotive */

// Shaped after a live response (19.09.2026), hyphenated count keys included.
const REMOTIVE_ROW: RemotiveJob = {
  id: 2091129,
  url: "https://remotive.com/remote-jobs/data/senior-data-scientist-2091129",
  title: "Senior Data Scientist",
  company_name: "Lemon.io",
  job_type: "full_time",
  publication_date: "2026-09-16T12:35:28",
  candidate_required_location: "Northern America, LATAM, Europe, APAC",
  salary: "",
  description: "<p>Are you a talented Senior Data Scientist?</p>",
};

describe("mapRemotiveJob", () => {
  it("maps the fields the feed actually publishes", () => {
    const job = mapRemotiveJob(REMOTIVE_ROW);
    expect(job.title).toBe("Senior Data Scientist");
    expect(job.company).toBe("Lemon.io");
    expect(job.location).toBe("Northern America, LATAM, Europe, APAC");
    expect(job.url).toContain("remotive.com");
    expect(job.employmentType).toBe("full_time");
    expect(job.postedDate).toBe("2026-09-16T12:35:28");
    expect(job.isRemote).toBe(true);
  });

  // "" is what the feed sends when nobody quoted a range; stored as a salary it
  // reaches the LLM prompt as an empty pay band.
  it("drops an empty salary rather than storing it", () => {
    expect(mapRemotiveJob(REMOTIVE_ROW).salary).toBeUndefined();
    expect(mapRemotiveJob({ ...REMOTIVE_ROW, salary: "$90k" }).salary).toBe("$90k");
  });

  it("falls back to Remote when the feed states no candidate location", () => {
    expect(
      mapRemotiveJob({ ...REMOTIVE_ROW, candidate_required_location: "" }).location,
    ).toBe("Remote");
  });
});

describe("searchRemotiveJobs", () => {
  afterEach(() => vi.restoreAllMocks());

  // The count keys are hyphenated and there is no total_count; reading the name
  // every other feed uses would report unknown depth forever.
  it("reads coverage from the hyphenated total-job-count", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({
        "job-count": 1,
        "total-job-count": 16,
        total_count: 9999,
        jobs: [REMOTIVE_ROW],
      }),
    );

    const out = await searchRemotiveJobs({ maxPages: 5 });
    expect(out.jobs).toHaveLength(1);
    expect(out.errors).toHaveLength(0);
    expect(out.coverage).toEqual({ fetched: 1, available: 16 });
  });

  // The endpoint has no cursor and ignores limit; a maxPages loop would refetch
  // the same rows N times against a host that blocks excessive requests.
  it("issues exactly one request whatever maxPages says", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(okJson({ jobs: [REMOTIVE_ROW] }));

    await searchRemotiveJobs({ maxPages: 40 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reports unknown depth as null, never 0", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ jobs: [REMOTIVE_ROW] }));
    expect((await searchRemotiveJobs({ maxPages: 1 })).coverage).toEqual({
      fetched: 1,
      available: null,
    });
  });

  // A blocked response and a feed with nothing new are both empty; treating the
  // first as the second would finalize a blocked run as a quiet one.
  it("reports a non-feed 200 as an error, not a clean zero", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ message: "maintenance" }));

    const out = await searchRemotiveJobs({ maxPages: 1 });
    expect(out.jobs).toHaveLength(0);
    expect(out.errors[0].reason).toContain("not the feed");
  });

  it("names a 429 as rate limiting rather than a bare status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({}, 429));
    expect((await searchRemotiveJobs({ maxPages: 1 })).errors[0].reason).toBe(
      "rate limited",
    );
  });

  it("reports a timeout without throwing", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );

    const out = await searchRemotiveJobs({ maxPages: 1 });
    expect(out.jobs).toHaveLength(0);
    expect(out.errors[0]).toEqual({ token: "remotive", reason: "timed out" });
  });
});

/* -------------------------------------------------------- Working Nomads */

const NOMADS_ROW: WorkingNomadsJob = {
  url: "https://www.workingnomads.com/job/go/1873858/",
  title: "Senior Backend Engineer",
  description: "<p>Join our team</p>",
  company_name: "TELUS Digital",
  category_name: "Development",
  tags: "python,django,postgres",
  location: "Global",
  pub_date: "2026-09-18T10:21:10-04:00",
};

describe("mapWorkingNomadsJob", () => {
  it("maps the fields the feed actually publishes", () => {
    const job = mapWorkingNomadsJob(NOMADS_ROW);
    expect(job.title).toBe("Senior Backend Engineer");
    expect(job.company).toBe("TELUS Digital");
    expect(job.location).toBe("Global");
    expect(job.url).toBe("https://www.workingnomads.com/job/go/1873858/");
    expect(job.postedDate).toBe("2026-09-18T10:21:10-04:00");
    expect(job.isRemote).toBe(true);
  });

  // The payload has no id field at all; the old collector's `x.id ?? <url tail>`
  // took the fallback on every row, which is why the bug looked harmless.
  it("does not depend on an id the payload never carries", () => {
    const job = mapWorkingNomadsJob({ ...NOMADS_ROW });
    expect(job.url).toContain("/job/go/1873858/");
  });

  it("resolves a relative path against the feed host", () => {
    expect(workingNomadsUrl("/job/go/1873858/")).toBe(
      "https://www.workingnomads.com/job/go/1873858/",
    );
    expect(workingNomadsUrl("https://elsewhere.test/x")).toBe(
      "https://elsewhere.test/x",
    );
    expect(workingNomadsUrl("")).toBe("");
  });
});

describe("searchWorkingNomadsJobs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps a bare top-level array in one request", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(okJson([NOMADS_ROW]));

    const out = await searchWorkingNomadsJobs({ maxPages: 9 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.jobs).toHaveLength(1);
    expect(out.coverage).toEqual({ fetched: 1, available: null });
  });

  // With no envelope to inspect, "is it an array" is the only thing separating
  // a blocked response from an exhausted feed.
  it("reports a non-array 200 as an error, not a clean zero", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ detail: "blocked" }));

    const out = await searchWorkingNomadsJobs({ maxPages: 1 });
    expect(out.jobs).toHaveLength(0);
    expect(out.errors[0].reason).toContain("not the feed");
  });

  it("reports an empty feed as a clean zero with no error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson([]));

    const out = await searchWorkingNomadsJobs({ maxPages: 1 });
    expect(out.jobs).toHaveLength(0);
    expect(out.errors).toHaveLength(0);
  });

  it("reports a 500 without throwing", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({}, 500));
    expect((await searchWorkingNomadsJobs({ maxPages: 1 })).errors[0].reason).toBe(
      "returned 500",
    );
  });
});

/* ------------------------------------------------------------ Jobspresso */

// One real card's markup: nested <li> meta items, an <img class="company_logo">
// ahead of the company name, a tagline sharing the company div, and an entity
// in the title.
function card(id: number, category: string, title: string): string {
  return `<li id="job_listing-${id}" class="job_listing post-${id} type-job_listing status-publish hentry job_listing_category-${category} job_listing_type-developer job-type-engineer" data-title="${title} at Hopper" data-href="https://jobspresso.co/job/role-${id}/">
\t<a href="https://jobspresso.co/job/role-${id}/" class="job_listing-clickbox"></a>
\t<div class="job_listing-logo">
\t\t<img class="company_logo" src="https://jobspresso.co/wp-content/uploads/n1-150x150.png" alt="Hopper" />\t</div><div class="job_listing-about">
\t\t<div class="job_listing-position job_listing__column">
\t\t\t<h3 class="job_listing-title">${title}</h3>
\t\t\t<div class="job_listing-company">
\t\t\t\t<strong>Hopper</strong> \t\t\t\t<span class="job_listing-company-tagline">Hopper uses big data to predict flight and hotel prices</span>\t\t\t</div>
\t\t</div>
\t\t<div class="job_listing-location job_listing__column">
\t\t\t<a class="google_map_link" href="http://maps.google.com/maps?q=Canada&#038;zoom=14" target="_blank">Canada</a>\t\t</div>
\t\t<ul class="job_listing-meta job_listing__column">
\t\t\t<li class="job_listing-type job-type developer">Engineer</li>
\t\t\t<li class="job_listing-date">August 28</li>
\t\t</ul>
\t</div>
</li>
`;
}

const CARD = card(163412, "contract", "Senior Full Stack Engineer, Realtime &#038; Voice");

describe("parseJobspressoListings", () => {
  it("counts cards, not the <li> elements nested inside them", () => {
    // Three cards contain six meta <li> between them; a "<li " split sees nine.
    const html = card(1, "full-time", "A") + card(2, "contract", "B") + card(3, "part-time", "C");
    expect(html.split(/<li /i).slice(1)).toHaveLength(9);
    expect(parseJobspressoListings(html)).toHaveLength(3);
  });

  it("keeps the first card when the blob starts with one", () => {
    expect(parseJobspressoListings(card(1, "full-time", "Only Card"))).toHaveLength(1);
  });

  it("ignores whatever precedes the first card", () => {
    const html = `<div class="job_listings">\n` + card(1, "full-time", "A");
    expect(parseJobspressoListings(html)).toHaveLength(1);
  });

  it("takes the title from the h3, not the 'Role at Company' data-title", () => {
    const [job] = parseJobspressoListings(CARD);
    expect(job.title).toBe("Senior Full Stack Engineer, Realtime & Voice");
    expect(job.title).not.toContain("at Hopper");
  });

  // The div holds the tagline too, and the first class containing "company" on
  // the card belongs to the logo <img>.
  it("takes the company from the <strong>, without the tagline or the logo", () => {
    const [job] = parseJobspressoListings(CARD);
    expect(job.company).toBe("Hopper");
  });

  it("takes the location from the maps link text", () => {
    expect(parseJobspressoListings(CARD)[0].location).toBe("Canada");
  });

  // The visible badge is a department ("Engineer"); the employment type is in
  // the job_listing_category-* class.
  it("takes the employment type from the category class, not the badge", () => {
    expect(parseJobspressoListings(CARD)[0].employmentType).toBe("contract");
    expect(
      parseJobspressoListings(card(2, "full-time", "B"))[0].employmentType,
    ).toBe("full-time");
  });

  // "August 28" has no year, so any date built from it is a guess.
  it("leaves postedDate unset rather than guessing a year", () => {
    expect(parseJobspressoListings(CARD)[0].postedDate).toBeUndefined();
  });

  it("carries the card's apply link and no description", () => {
    const [job] = parseJobspressoListings(CARD);
    expect(job.url).toBe("https://jobspresso.co/job/role-163412/");
    expect(job.description).toBe("");
  });

  it("skips a card with no link or no title", () => {
    expect(
      parseJobspressoListings(
        `<li id="job_listing-9" class="job_listing job_listing_category-full-time"><h3 class="job_listing-title">Orphan</h3></li>`,
      ),
    ).toHaveLength(0);
  });
});

describe("jobspressoPageBody", () => {
  it("sends the WP Job Manager action as form fields", () => {
    const body = jobspressoPageBody(3);
    expect(body.get("action")).toBe("job_manager_get_listings");
    expect(body.get("page")).toBe("3");
    expect(body.get("per_page")).toBe(String(APP_CONSTANTS.JOBSPRESSO_PAGE_LIMIT));
  });
});

describe("searchJobspressoJobs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("POSTs the listing action", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(okJson({ html: CARD, max_num_pages: 1 }));

    const out = await searchJobspressoJobs({ maxPages: 1 });
    expect(out.jobs).toHaveLength(1);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("job_manager_get_listings");
  });

  // Crawl-delay 3 makes each extra page cost three seconds, so stopping on the
  // stated page count saves a wasted request plus its delay on every run.
  it("stops at max_num_pages instead of walking to maxPages", async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(okJson({ html: CARD, max_num_pages: 2 }));

    const promise = searchJobspressoJobs({ maxPages: 10 });
    await vi.runAllTimersAsync();
    const out = await promise;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.jobs).toHaveLength(2);
  });

  // The configured count is a request, not a licence.
  it("never exceeds JOBSPRESSO_MAX_PAGES however large maxPages is", async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(okJson({ html: CARD, max_num_pages: 9999 }));

    const promise = searchJobspressoJobs({ maxPages: 5000 });
    await vi.runAllTimersAsync();
    await promise;

    expect(spy).toHaveBeenCalledTimes(APP_CONSTANTS.JOBSPRESSO_MAX_PAGES);
  });

  it("ends the crawl quietly on a page with no cards", async () => {
    vi.useFakeTimers();
    let call = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      okJson(++call === 1 ? { html: CARD, max_num_pages: 9 } : { html: "", max_num_pages: 9 }),
    );

    const promise = searchJobspressoJobs({ maxPages: 9 });
    await vi.runAllTimersAsync();
    const out = await promise;

    expect(out.jobs).toHaveLength(1);
    expect(out.errors).toHaveLength(0);
  });

  // admin-ajax answers a rejected action with a bare 0 and no html key; reading
  // that as "the board ran out" would finalize a blocked run as a quiet one.
  it("reports a 200 with no html key as an error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson(0));

    const out = await searchJobspressoJobs({ maxPages: 1 });
    expect(out.jobs).toHaveLength(0);
    expect(out.errors[0].reason).toContain("not a listing page");
  });

  it("keeps the pages it already fetched when a later one fails", async () => {
    vi.useFakeTimers();
    let call = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      ++call === 1 ? okJson({ html: CARD, max_num_pages: 9 }) : okJson({}, 503),
    );

    const promise = searchJobspressoJobs({ maxPages: 9 });
    await vi.runAllTimersAsync();
    const out = await promise;

    expect(out.jobs).toHaveLength(1);
    expect(out.errors[0].reason).toContain("returned 503");
  });

  // max_num_pages counts pages, and pages x per_page is an estimate the last
  // page falsifies.
  it("reports depth as null rather than estimating it from the page count", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ html: CARD, max_num_pages: 28, found_jobs: true }),
    );

    expect((await searchJobspressoJobs({ maxPages: 1 })).coverage).toEqual({
      fetched: 1,
      available: null,
    });
  });
});

/* ------------------------------------------------------------ Remote.com */

// Shaped after a live row (19.09.2026): apply_url null, description empty,
// compensation in minor units, hiring_location global with no included list.
const REMOTECOM_ROW: RemotecomJob = {
  title: "Senior Backend Developer (Python/Django)",
  slug: "senior-backend-developer-python-django-j12wcpci",
  description: "",
  published_at: "2026-08-28T07:16:12Z",
  employment_type: "full_time",
  apply_url: null,
  visa_sponsorship_offered: false,
  company_profile: { name: "Proxify", slug: "proxify-c114ohln" },
  compensation: {
    minimum: 300000,
    maximum: 600000,
    currency: { code: "EUR" },
    frequency: "monthly",
  },
  hiring_location: { type: "global", included_locations: null },
  workplace_location: { type: "remote" },
};

describe("remotecomJobUrl", () => {
  // apply_url is null on roughly two rows in three, and a job stored with no
  // URL dedupes on title|company|location instead.
  it("builds the posting page from the two slugs, not from apply_url", () => {
    expect(remotecomJobUrl(REMOTECOM_ROW)).toBe(
      "https://remote.com/jobs/proxify-c114ohln/senior-backend-developer-python-django-j12wcpci",
    );
    expect(mapRemotecomJob(REMOTECOM_ROW).url).toContain("remote.com/jobs/");
  });

  it("returns empty when either slug is missing", () => {
    expect(remotecomJobUrl({ ...REMOTECOM_ROW, slug: undefined })).toBe("");
    expect(remotecomJobUrl({ ...REMOTECOM_ROW, company_profile: null })).toBe("");
  });
});

describe("remotecomLocation", () => {
  // The one thing this board is collected for; it arrives with the list null.
  it("renders a global hiring location as Worldwide", () => {
    expect(remotecomLocation(REMOTECOM_ROW)).toBe("Worldwide");
  });

  it("joins the included location names", () => {
    expect(
      remotecomLocation({
        hiring_location: {
          type: "location",
          included_locations: [
            { value: { name: "South Africa" } },
            { value: { name: "Kenya" } },
            {},
          ],
        },
      }),
    ).toBe("South Africa, Kenya");
  });

  // "Denver" there is an offset anchor, not a place the job is worked.
  it("leaves a timezone-anchored posting without a location", () => {
    expect(remotecomLocation({ hiring_location: { type: "timezone" } })).toBe("");
    expect(remotecomLocation({ hiring_location: null })).toBe("");
  });
});

describe("remotecomSalary", () => {
  // Minor units: 300000 EUR monthly is EUR 3000, not EUR 300 000.
  it("scales minor units into the currency's major unit", () => {
    expect(remotecomSalary(REMOTECOM_ROW)).toBe("3000-6000 EUR monthly");
  });

  it("prints a single figure when only one bound is set", () => {
    expect(
      remotecomSalary({
        compensation: { minimum: null, maximum: 1600000, currency: { code: "USD" }, frequency: "yearly" },
      }),
    ).toBe("16000 USD yearly");
  });

  it("returns undefined when no pay is stated", () => {
    expect(remotecomSalary({ compensation: null })).toBeUndefined();
    expect(remotecomSalary({ compensation: { minimum: 0, maximum: 0 } })).toBeUndefined();
  });
});

describe("mapRemotecomJob", () => {
  it("maps the workplace type onto the WORKPLACE_TYPES keys", () => {
    expect(mapRemotecomJob(REMOTECOM_ROW).workplaceType).toBe("REMOTE");
    expect(
      mapRemotecomJob({ ...REMOTECOM_ROW, workplace_location: { type: "on_site" } })
        .workplaceType,
    ).toBe("ONSITE");
    expect(
      mapRemotecomJob({ ...REMOTECOM_ROW, workplace_location: { type: "hybrid" } })
        .workplaceType,
    ).toBe("HYBRID");
    expect(
      mapRemotecomJob({ ...REMOTECOM_ROW, workplace_location: null }).workplaceType,
    ).toBeUndefined();
  });

  it("carries the list endpoint's empty description through untouched", () => {
    expect(mapRemotecomJob(REMOTECOM_ROW).description).toBe("");
  });
});

describe("remotecomPageUrl", () => {
  it("pages by a 1-based page number", () => {
    expect(remotecomPageUrl(1)).toBe(`${APP_CONSTANTS.REMOTECOM_BASE_URL}?page=1`);
    expect(remotecomPageUrl(7)).toContain("page=7");
  });
});

describe("searchRemotecomJobs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads coverage from total_count", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({
        data: { jobs: [REMOTECOM_ROW], total_count: 6153, current_page: 1, total_pages: 1 },
      }),
    );

    const out = await searchRemotecomJobs({ maxPages: 1 });
    expect(out.jobs).toHaveLength(1);
    expect(out.coverage).toEqual({ fetched: 1, available: 6153 });
  });

  it("stops at total_pages instead of walking to maxPages", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ data: { jobs: [REMOTECOM_ROW], total_count: 40, total_pages: 2 } }),
    );

    const out = await searchRemotecomJobs({ maxPages: 9 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.jobs).toHaveLength(2);
  });

  it("never exceeds REMOTECOM_MAX_PAGES however large maxPages is", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ data: { jobs: [REMOTECOM_ROW], total_count: 6153, total_pages: 308 } }),
    );

    const promise = searchRemotecomJobs({ maxPages: 300 });
    await vi.runAllTimersAsync();
    await promise;
    expect(spy).toHaveBeenCalledTimes(APP_CONSTANTS.REMOTECOM_MAX_PAGES);
  });

  it("reports a 200 that is not a job page as an error, not an end of feed", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ error: "unavailable" }));

    const out = await searchRemotecomJobs({ maxPages: 3 });
    expect(out.jobs).toHaveLength(0);
    expect(out.errors[0].reason).toContain("not a job page");
  });

  it("keeps the pages it already fetched when a later one fails", async () => {
    let call = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      ++call === 1
        ? okJson({ data: { jobs: [REMOTECOM_ROW], total_count: 40, total_pages: 9 } })
        : okJson({}, 502),
    );

    const out = await searchRemotecomJobs({ maxPages: 9 });
    expect(out.jobs).toHaveLength(1);
    expect(out.errors[0].reason).toContain("returned 502");
    expect(out.coverage).toEqual({ fetched: 1, available: 40 });
  });
});

describe("hydrateRemotecomJobs", () => {
  afterEach(() => vi.restoreAllMocks());

  const listed = (): JobDetails => ({ ...mapRemotecomJob(REMOTECOM_ROW) });

  it("fetches the detail endpoint derived from the posting URL", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ data: { description: "<h2>Position Overview</h2>" } }),
    );

    const [filled] = await hydrateRemotecomJobs([listed()]);
    expect(filled.description).toContain("Position Overview");
    expect(String(spy.mock.calls[0][0])).toBe(
      `${APP_CONSTANTS.REMOTECOM_BASE_URL}/proxify-c114ohln/senior-backend-developer-python-django-j12wcpci`,
    );
  });

  // The runner matches hydrated jobs back by URL, so a shorter array is the
  // documented way to say "this posting is gone".
  it("skips a withdrawn posting instead of failing the pass", async () => {
    let call = 0;
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      ++call === 1 ? okJson({}, 404) : okJson({ data: { description: "<p>Body</p>" } }),
    );

    const other = { ...listed(), url: listed().url.replace("j12wcpci", "j9zzzzzz") };
    const out = await hydrateRemotecomJobs([listed(), other]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("j9zzzzzz");
  });

  it("skips a job whose URL is not a remote.com posting", async () => {
    const spy = vi.spyOn(global, "fetch");
    const out = await hydrateRemotecomJobs([
      { ...listed(), url: "https://example.test/job/1" },
    ]);
    expect(out).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops when the run is aborted", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(okJson({ data: { description: "<p>Body</p>" } }));

    const out = await hydrateRemotecomJobs([listed()], AbortSignal.abort());
    expect(out).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------ Jobspresso hydration */

// The listing blob carries no ad text at all — a title, a company, a location
// and a one-line company tagline — so without this pass every Jobspresso row is
// saved with description "" and scored against its title alone.
describe("parseJobspressoDescription", () => {
  const page = (body: string) =>
    `<div class="job-overview-content row">` +
    `<div class="job_listing-description job-overview col-md-10 col-sm-12">` +
    `<h2 class="widget-title widget-title--job_listing-top">Overview</h2>${body}` +
    `</div><div class="job-meta col-md-2 col-sm-6"><aside>Hopper</aside></div>`;

  it("keeps the whole ad, nested markup and all", () => {
    // Bounded by the job-meta sidebar that follows, not by a closing tag: the
    // ad contains its own divs, and a lazy match to the first </div> stops at
    // the opening paragraph.
    expect(
      parseJobspressoDescription(
        page("<p>Python and Go.</p><div><ul><li>5 years</li></ul></div>"),
      ),
    ).toBe("Python and Go. 5 years");
  });

  it("drops the Overview heading, which is the same word on every posting", () => {
    expect(parseJobspressoDescription(page("<p>Body</p>"))).toBe("Body");
  });

  it("returns nothing when the page is not a posting", () => {
    expect(parseJobspressoDescription("<html><body>404</body></html>")).toBe("");
  });
});

describe("hydrateJobspressoJobs", () => {
  const listed = (): JobDetails => ({
    title: "Backend Engineer",
    company: "Hopper",
    location: "Canada",
    description: "",
    url: "https://jobspresso.co/job/backend-engineer/",
  });

  it("fills in the description the listing could not carry", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        `<div class="job_listing-description job-overview"><p>Python.</p>` +
        `</div><div class="job-meta col-md-2">`,
    } as Response);

    const out = await hydrateJobspressoJobs([listed()]);
    expect(out).toEqual([{ ...listed(), description: "Python." }]);
  });

  // The runner matches what comes back by URL, so a short array is allowed —
  // and a job returned with an empty description would still be counted in the
  // "loaded full details for N of M" line.
  it("skips a posting taken down between the sweep and this pass", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "",
    } as Response);

    expect(await hydrateJobspressoJobs([listed()])).toHaveLength(0);
  });

  it("stops when the run is aborted", async () => {
    const spy = vi.spyOn(global, "fetch");
    const out = await hydrateJobspressoJobs([listed()], AbortSignal.abort());
    expect(out).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------ feed cancellation */

// Every feed walks pages behind a politeness delay, and until search() took a
// signal none of them could be stopped: the runner's first `aborted` check came
// after search() returned.
describe("cancelling a feed walk", () => {
  it("stops Remote.com between pages instead of after the last one", async () => {
    const controller = new AbortController();
    const spy = vi.spyOn(global, "fetch").mockImplementation(async () => {
      controller.abort();
      return okJson({
        data: { jobs: [REMOTECOM_ROW], total_count: 6153, total_pages: 308 },
      });
    });

    const out = await searchRemotecomJobs({ maxPages: 5 }, controller.signal);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.jobs).toHaveLength(1);
  });

  it("stops Jobspresso before spending another crawl delay", async () => {
    const controller = new AbortController();
    const spy = vi.spyOn(global, "fetch").mockImplementation(async () => {
      controller.abort();
      return okJson({ html: CARD, max_num_pages: 10 });
    });

    await searchJobspressoJobs({ maxPages: 5 }, controller.signal);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
