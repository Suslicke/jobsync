import {
  fetchRipplingBoardJobs,
  hydrateRipplingJobs,
  mapRipplingListJob,
  mergeRipplingDetail,
  parseRipplingJobUrl,
  searchRipplingJobs,
} from "@/lib/scraper/rippling";
import {
  fetchWorkableBoardJobs,
  mapWorkableListJob,
  mergeWorkableDetail,
  parseWorkableJobUrl,
  searchWorkableJobs,
  workableJobUrl,
} from "@/lib/scraper/workable";
import {
  fetchSmartRecruitersBoardJobs,
  mapSmartRecruitersPosting,
  mergeSmartRecruitersDetail,
  parseSmartRecruitersJobUrl,
  searchSmartRecruitersJobs,
} from "@/lib/scraper/smartrecruiters";
import {
  fetchPersonioBoardJobs,
  mapPersonioPosition,
  parsePersonioXml,
} from "@/lib/scraper/personio";
import {
  fetchRecruiteeBoardJobs,
  mapRecruiteeOffer,
  searchRecruiteeJobs,
} from "@/lib/scraper/recruitee";
import type { JobDetails } from "@/lib/scraper/types";

// Shapes below are copied from live responses captured on 19.09.2026, not from
// the old collector's field names — that collector asked Rippling for
// `description` and Workable for `published_on`, neither of which exists.

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function okText(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

afterEach(() => vi.restoreAllMocks());

describe("Rippling", () => {
  const listJob = {
    uuid: "d1a65189",
    name: "Senior Backend Engineer ",
    url: "https://ats.rippling.com/chess/jobs/d1a65189",
    department: { id: "Engineering", label: "Engineering" },
    workLocation: { id: "Remote (USA) ", label: "Remote (USA) " },
  };

  it("maps a listing with no description, because the list carries none", () => {
    const job = mapRipplingListJob(listJob, "Chess.com", "chess");
    expect(job).toMatchObject({
      title: "Senior Backend Engineer",
      company: "Chess.com",
      location: "Remote (USA)",
      description: "",
      url: "https://ats.rippling.com/chess/jobs/d1a65189",
    });
  });

  it("builds the posting URL when the list omits it", () => {
    const job = mapRipplingListJob({ uuid: "abc" }, "Chess.com", "chess");
    expect(job.url).toBe("https://ats.rippling.com/chess/jobs/abc");
  });

  it("parses the slug and uuid back out of a posting URL", () => {
    expect(parseRipplingJobUrl("https://ats.rippling.com/chess/jobs/abc")).toEqual(
      { token: "chess", uuid: "abc" },
    );
  });

  it("refuses a URL from another host or shape", () => {
    expect(parseRipplingJobUrl("https://jobs.lever.co/chess/abc")).toBeNull();
    expect(parseRipplingJobUrl("https://ats.rippling.com/chess")).toBeNull();
    expect(parseRipplingJobUrl("not a url")).toBeNull();
  });

  it("joins both description halves — the role half holds the requirements", () => {
    const merged = mergeRipplingDetail(
      mapRipplingListJob(listJob, "Chess.com", "chess"),
      {
        description: { company: "<p>About us</p>", role: "<p>Python, Go</p>" },
        workLocations: ["Remote (USA)", "Berlin"],
        employmentType: { label: "SALARIED_FT", id: "Salaried, full-time" },
        createdOn: "2026-09-03T11:33:04.273000-07:00",
        companyName: "Chess.com",
      },
    );
    expect(merged.description).toBe("<p>About us</p>\n<p>Python, Go</p>");
    expect(merged.location).toBe("Remote (USA), Berlin");
    expect(merged.postedDate).toBe("2026-09-03T11:33:04.273000-07:00");
  });

  // label/id are reversed on this one field: `label` is the enum.
  it("takes the human employment type out of `id`, not `label`", () => {
    const merged = mergeRipplingDetail(
      mapRipplingListJob(listJob, "Chess.com", "chess"),
      { employmentType: { label: "SALARIED_FT", id: "Salaried, full-time" } },
    );
    expect(merged.employmentType).toBe("Salaried, full-time");
  });

  // runAtsRun matches a hydrated job back to its ranked listing by URL.
  it("never rewrites the URL it was handed", () => {
    const listing = mapRipplingListJob(listJob, "Chess.com", "chess");
    const merged = mergeRipplingDetail(listing, {
      uuid: "other",
      description: { role: "<p>Body</p>" },
    });
    expect(merged.url).toBe(listing.url);
  });

  it("fetches a whole board in one call", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(okJson([listJob]));

    const result = await fetchRipplingBoardJobs("Chess.com", "chess");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toBe(
      "https://api.rippling.com/platform/api/ats/v1/board/chess/jobs",
    );
    expect(result.success && result.data).toHaveLength(1);
  });

  // A wrong slug answering an error envelope must not read as a board with
  // nothing open.
  it("treats a non-array payload as a failure, not an empty board", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ error: "not found" }));
    const result = await fetchRipplingBoardJobs("Chess.com", "chess");
    expect(result).toMatchObject({
      success: false,
      error: { type: "parse" },
    });
  });

  it("reports a 429 as rate limited", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({}, 429));
    const result = await fetchRipplingBoardJobs("Chess.com", "chess");
    expect(result).toMatchObject({ success: false, error: { type: "rate_limited" } });
  });

  it("keeps one dead board from costing the others their postings", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) =>
      String(input).includes("/dead/") ? okJson({}, 404) : okJson([listJob]),
    );

    const outcome = await searchRipplingJobs([
      { name: "Dead", token: "dead" },
      { name: "Chess.com", token: "chess" },
    ]);

    expect(outcome.jobs).toHaveLength(1);
    expect(outcome.errors).toEqual([
      { token: "dead", reason: "Board 'dead' returned 404" },
    ]);
  });

  it("drops a posting that 404s mid-hydrate and keeps the rest", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("gone")
        ? okJson({}, 404)
        : okJson({ description: { role: "<p>Body</p>" } }),
    );

    const listing = (url: string): JobDetails => ({
      title: "Backend Engineer",
      company: "Chess.com",
      location: "Remote",
      description: "",
      url,
    });

    const hydrated = await hydrateRipplingJobs([
      listing("https://ats.rippling.com/chess/jobs/gone"),
      listing("https://ats.rippling.com/chess/jobs/live"),
    ]);

    expect(hydrated).toHaveLength(1);
    expect(hydrated[0].description).toBe("<p>Body</p>");
  });
});

describe("Workable", () => {
  const listJob = (shortcode: string, overrides = {}) => ({
    shortcode,
    title: "Development Manager",
    remote: true,
    location: { country: "United States", city: "" },
    locations: [{ country: "United States", city: "" }],
    published: "2026-09-15T00:00:00.000Z",
    type: "full",
    workplace: "remote",
    ...overrides,
  });

  it("builds the public posting URL from the shortcode, never the id", () => {
    expect(workableJobUrl("action1", "F6C5107433")).toBe(
      "https://apply.workable.com/action1/j/F6C5107433/",
    );
  });

  it("maps a listing, falling back to Remote when no office is named", () => {
    const job = mapWorkableListJob(
      { shortcode: "X1", title: "Backend Engineer", remote: true },
      "Action1",
      "action1",
    );
    expect(job).toMatchObject({
      title: "Backend Engineer",
      company: "Action1",
      location: "Remote",
      description: "",
      url: "https://apply.workable.com/action1/j/X1/",
    });
  });

  it("takes the posted date from `published` and the workplace from `workplace`", () => {
    const job = mapWorkableListJob(listJob("X1"), "Action1", "action1");
    expect(job.postedDate).toBe("2026-09-15T00:00:00.000Z");
    expect(job.workplaceType).toBe("REMOTE");
    expect(job.employmentType).toBe("full");
  });

  it("leaves the workplace unmeasured rather than guessing on-site", () => {
    const job = mapWorkableListJob(
      { shortcode: "X1", workplace: "flexible" },
      "Action1",
      "action1",
    );
    expect(job.workplaceType).toBeUndefined();
  });

  // Ten rows a page is the API's fixed size, so a board of 16 that is not paged
  // silently loses six.
  it("follows nextPage and POSTs the token back", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        okJson({
          total: 16,
          results: Array.from({ length: 10 }, (_, i) => listJob(`A${i}`)),
          nextPage: "cursor-2",
        }),
      )
      .mockResolvedValueOnce(
        okJson({
          total: 16,
          results: Array.from({ length: 6 }, (_, i) => listJob(`B${i}`)),
        }),
      );

    const result = await fetchWorkableBoardJobs("Action1", "action1");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][1]).toMatchObject({ method: "POST", body: "{}" });
    expect(spy.mock.calls[1][1]).toMatchObject({
      body: JSON.stringify({ token: "cursor-2" }),
    });
    expect(result.success && result.data.jobs).toHaveLength(16);
    expect(result.success && result.data.total).toBe(16);
  });

  it("stops when the cursor repeats instead of refetching the same page", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ total: 40, results: [listJob("A1")], nextPage: "stuck" }),
    );

    const result = await fetchWorkableBoardJobs("Action1", "action1");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.success && result.data.jobs).toHaveLength(2);
  });

  it("reports coverage so a fetched count cannot read as the whole board", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ total: 16, results: [listJob("A1")] }),
    );
    const outcome = await searchWorkableJobs([
      { name: "Action1", token: "action1" },
    ]);
    expect(outcome.coverage).toEqual({ fetched: 1, available: 16 });
  });

  it("leaves coverage unknown when every board failed", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({}, 500));
    const outcome = await searchWorkableJobs([
      { name: "Action1", token: "action1" },
    ]);
    expect(outcome.coverage).toEqual({ fetched: 0, available: null });
    expect(outcome.errors).toHaveLength(1);
  });

  it("parses the slug and shortcode back out of a posting URL", () => {
    expect(
      parseWorkableJobUrl("https://apply.workable.com/action1/j/F6C5107433/"),
    ).toEqual({ token: "action1", shortcode: "F6C5107433" });
    expect(parseWorkableJobUrl("https://apply.workable.com/action1")).toBeNull();
  });

  // The stack is named in `requirements`, which is a separate field.
  it("joins description, requirements and benefits", () => {
    const listing = mapWorkableListJob(listJob("X1"), "Action1", "action1");
    const merged = mergeWorkableDetail(listing, {
      description: "<p>About</p>",
      requirements: "<p>Python</p>",
      benefits: "<p>Remote</p>",
    });
    expect(merged.description).toBe("<p>About</p>\n<p>Python</p>\n<p>Remote</p>");
    expect(merged.url).toBe(listing.url);
  });
});

describe("SmartRecruiters", () => {
  const posting = (id: string, overrides = {}) => ({
    id,
    name: "Senior Data Platform Engineer",
    location: {
      city: "Remote",
      region: "REMOTE",
      country: "us",
      remote: true,
      hybrid: false,
      fullLocation: "Remote, REMOTE, United States",
    },
    typeOfEmployment: { id: "permanent", label: "Full-time" },
    releasedDate: "2026-09-18T17:42:08.569Z",
    ...overrides,
  });

  it("maps a posting from `name`, with no description on the list", () => {
    const job = mapSmartRecruitersPosting(posting("744"), "Mirantis", "Mirantis");
    expect(job).toMatchObject({
      title: "Senior Data Platform Engineer",
      company: "Mirantis",
      location: "Remote, REMOTE, United States",
      description: "",
      url: "https://jobs.smartrecruiters.com/Mirantis/744",
      postedDate: "2026-09-18T17:42:08.569Z",
      employmentType: "Full-time",
      workplaceType: "REMOTE",
    });
  });

  // The compact country field is a lowercase ISO code, which no location filter
  // is written in.
  it("falls back to city and country when fullLocation is absent", () => {
    const job = mapSmartRecruitersPosting(
      posting("744", { location: { city: "Barcelona", country: "es" } }),
      "Mirantis",
      "Mirantis",
    );
    expect(job.location).toBe("Barcelona, es");
  });

  it("reads on-site off both flags being false, and nothing off a missing location", () => {
    expect(
      mapSmartRecruitersPosting(
        posting("1", { location: { remote: false, hybrid: false } }),
        "M",
        "M",
      ).workplaceType,
    ).toBe("ONSITE");
    expect(
      mapSmartRecruitersPosting(posting("1", { location: null }), "M", "M")
        .workplaceType,
    ).toBeUndefined();
  });

  it("pages by offset and stops on a short page", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        okJson({
          totalFound: 150,
          content: Array.from({ length: 100 }, (_, i) => posting(`a${i}`)),
        }),
      )
      .mockResolvedValueOnce(
        okJson({
          totalFound: 150,
          content: Array.from({ length: 50 }, (_, i) => posting(`b${i}`)),
        }),
      );

    const result = await fetchSmartRecruitersBoardJobs("Mirantis", "Mirantis");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[0][0])).toContain("limit=100&offset=0");
    expect(String(spy.mock.calls[1][0])).toContain("limit=100&offset=100");
    expect(result.success && result.data.jobs).toHaveLength(150);
  });

  it("reports totalFound as the board's real depth", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ totalFound: 93, content: [posting("744")] }),
    );
    const outcome = await searchSmartRecruitersJobs([
      { name: "Mirantis", token: "Mirantis" },
    ]);
    expect(outcome.coverage).toEqual({ fetched: 1, available: 93 });
  });

  // The slug is case sensitive: it goes into the URL as it was saved.
  it("keeps the slug's capitalisation in the request URL", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(okJson({ totalFound: 0, content: [] }));
    await fetchSmartRecruitersBoardJobs("Mirantis", "Mirantis");
    expect(String(spy.mock.calls[0][0])).toContain("/companies/Mirantis/postings");
  });

  it("parses the slug and id back out of a posting URL", () => {
    expect(
      parseSmartRecruitersJobUrl("https://jobs.smartrecruiters.com/Mirantis/744"),
    ).toEqual({ token: "Mirantis", id: "744" });
    expect(parseSmartRecruitersJobUrl("https://example.com/Mirantis/744")).toBeNull();
  });

  it("joins the four ad sections in reading order, bodies only", () => {
    const listing = mapSmartRecruitersPosting(posting("744"), "Mirantis", "Mirantis");
    const merged = mergeSmartRecruitersDetail(listing, {
      jobAd: {
        sections: {
          qualifications: { title: "Qualifications", text: "<p>Kafka</p>" },
          companyDescription: { title: "Company Description", text: "<p>About</p>" },
          jobDescription: { title: "Job Description", text: "<p>Own the platform</p>" },
        },
      },
    });
    expect(merged.description).toBe(
      "<p>About</p>\n<p>Own the platform</p>\n<p>Kafka</p>",
    );
    // The detail's own postingUrl carries a title slug and would break the
    // URL match runAtsRun does after hydration.
    expect(merged.url).toBe(listing.url);
  });
});

describe("Personio", () => {
  // Two sections, so the heading tag <name> appears three times for one job:
  // once as the title and once per section.
  const boardXml = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position>
  <id>2781380</id>
  <office>Berlin</office>
  <department>Engineering</department>
  <name>Backend Engineer (m/f/d)</name>
  <additionalOffices>
    <office>Hamburg</office>
    <office>Berlin</office>
  </additionalOffices>
  <jobDescriptions>
    <jobDescription>
      <name>About The Role</name>
      <value><![CDATA[Vivid is <strong>hiring</strong>.]]></value>
    </jobDescription>
    <jobDescription>
      <name>Your Mission</name>
      <value><![CDATA[<ul><li>Python &amp; FastAPI</li></ul>]]></value>
    </jobDescription>
  </jobDescriptions>
  <employmentType>permanent</employmentType>
  <schedule>full-time</schedule>
  <createdAt>2026-09-03T19:15:48+00:00</createdAt>
</position>
</workzag-jobs>`;

  it("reads the title from the position, not from a description heading", () => {
    const [position] = parsePersonioXml(boardXml);
    expect(position.title).toBe("Backend Engineer (m/f/d)");
  });

  // The old collector's strip() matched `<![CDATA[Vivid is <strong>` as one
  // tag and ate the opening sentence of every section.
  it("unwraps CDATA without eating the text in front of the first tag", () => {
    const [position] = parsePersonioXml(boardXml);
    expect(position.description).toContain("Vivid is <strong>hiring</strong>.");
    expect(position.description).toContain("<li>Python &amp; FastAPI</li>");
    expect(position.description).not.toContain("CDATA");
  });

  it("keeps the section headings, which are the job's own structure", () => {
    const [position] = parsePersonioXml(boardXml);
    expect(position.description).toContain("<h3>About The Role</h3>");
    expect(position.description).toContain("<h3>Your Mission</h3>");
  });

  it("joins the main office with the additional ones, deduped", () => {
    const [position] = parsePersonioXml(boardXml);
    expect(position.location).toBe("Berlin, Hamburg");
  });

  // employmentType says "permanent" — a contract, not a schedule.
  it("takes the employment type from `schedule`", () => {
    const [position] = parsePersonioXml(boardXml);
    expect(position.employmentType).toBe("full-time");
  });

  it("builds the posting URL on the host that answered", () => {
    const [position] = parsePersonioXml(boardXml);
    const job = mapPersonioPosition(position, "Vivid", "vivid.jobs.personio.com");
    expect(job.url).toBe("https://vivid.jobs.personio.com/job/2781380");
    expect(job.company).toBe("Vivid");
    expect(job.postedDate).toBe("2026-09-03T19:15:48+00:00");
  });

  it("fetches the .de host first and does not follow redirects", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(okText(boardXml));

    const result = await fetchPersonioBoardJobs("Vivid", "vivid");

    expect(String(spy.mock.calls[0][0])).toBe("https://vivid.jobs.personio.de/xml");
    expect(spy.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(result.success && result.data).toHaveLength(1);
  });

  it("falls back to the .com host when .de 404s", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(okText("", 404))
      .mockResolvedValueOnce(okText(boardXml));

    const result = await fetchPersonioBoardJobs("Vivid", "vivid");

    expect(String(spy.mock.calls[1][0])).toBe("https://vivid.jobs.personio.com/xml");
    expect(result.success && result.data[0].url).toBe(
      "https://vivid.jobs.personio.com/job/2781380",
    );
  });

  // An unknown subdomain answers 307 to the marketing site. Chased, that is a
  // 200 HTML page with no positions in it — a dead board reported as an empty
  // one.
  it("reports an unknown board as failed, never as a board with no jobs", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okText("", 307));
    const result = await fetchPersonioBoardJobs("Nope", "nope");
    expect(result).toMatchObject({
      success: false,
      error: { type: "network", message: "Board 'nope' returned 307" },
    });
  });

  it("rejects a 200 that is not a job feed", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okText("<html><body>Personio</body></html>"),
    );
    const result = await fetchPersonioBoardJobs("Nope", "nope");
    expect(result).toMatchObject({ success: false, error: { type: "parse" } });
  });

  it("accepts a real feed with no positions as an empty board", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okText('<?xml version="1.0"?><workzag-jobs></workzag-jobs>'),
    );
    const result = await fetchPersonioBoardJobs("Vivid", "vivid");
    expect(result).toMatchObject({ success: true, data: [] });
  });
});

describe("Recruitee", () => {
  const offer = (overrides = {}) => ({
    id: 2750242,
    title: "Backend Engineer",
    location: "Lafayette, Louisiana, United States",
    city: "Lafayette",
    country: "United States",
    remote: false,
    hybrid: false,
    on_site: true,
    employment_type_code: "fulltime_permanent",
    careers_url: "https://labordeearles.recruitee.com/o/backend-engineer",
    published_at: "2026-09-17 19:52:08 UTC",
    description: "<p>About us</p>",
    requirements: "<p>Python, PostgreSQL</p>",
    company_name: "Laborde Earles",
    ...overrides,
  });

  // The stack is named in `requirements`, a field of its own.
  it("joins description and requirements", () => {
    const job = mapRecruiteeOffer(offer(), "labordeearles");
    expect(job.description).toBe("<p>About us</p>\n<p>Python, PostgreSQL</p>");
  });

  it("prefers the employer's own name over the watchlist entry", () => {
    expect(mapRecruiteeOffer(offer(), "labordeearles").company).toBe(
      "Laborde Earles",
    );
    expect(
      mapRecruiteeOffer(offer({ company_name: "" }), "Laborde Earles").company,
    ).toBe("Laborde Earles");
  });

  // "parttime_permanent" folds to a single unknown token and would land on the
  // full-time default.
  it("takes only the schedule half of the employment code", () => {
    expect(mapRecruiteeOffer(offer(), "x").employmentType).toBe("fulltime");
    expect(
      mapRecruiteeOffer(offer({ employment_type_code: "parttime_permanent" }), "x")
        .employmentType,
    ).toBe("parttime");
  });

  it("normalizes the space-separated timestamp Recruitee publishes", () => {
    expect(mapRecruiteeOffer(offer(), "x").postedDate).toBe(
      "2026-09-17T19:52:08.000Z",
    );
  });

  it("maps the workplace off the flags the offer carries", () => {
    expect(mapRecruiteeOffer(offer(), "x").workplaceType).toBe("ONSITE");
    expect(
      mapRecruiteeOffer(offer({ remote: true, on_site: false }), "x").workplaceType,
    ).toBe("REMOTE");
    expect(
      mapRecruiteeOffer(offer({ hybrid: true, on_site: false }), "x").workplaceType,
    ).toBe("HYBRID");
    expect(
      mapRecruiteeOffer(
        { title: "Backend Engineer", careers_url: "https://x.recruitee.com/o/be" },
        "x",
      ).workplaceType,
    ).toBeUndefined();
  });

  it("fetches the board in one call and drops offers with no link", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(okJson({ offers: [offer(), offer({ careers_url: "" })] }));

    const result = await fetchRecruiteeBoardJobs("Laborde Earles", "labordeearles");

    expect(String(spy.mock.calls[0][0])).toBe(
      "https://labordeearles.recruitee.com/api/offers/",
    );
    expect(result.success && result.data).toHaveLength(1);
  });

  it("reports a retired slug's 404 as an error, not an empty board", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ error: "Not Found" }, 404),
    );
    const outcome = await searchRecruiteeJobs([
      { name: "Score Warrior", token: "scorewarrior" },
    ]);
    expect(outcome.jobs).toHaveLength(0);
    expect(outcome.errors).toEqual([
      { token: "scorewarrior", reason: "Board 'scorewarrior' returned 404" },
    ]);
  });

  it("accepts a live board with nothing open as an empty success", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ offers: [] }));
    const outcome = await searchRecruiteeJobs([
      { name: "Wallarm", token: "wallarm" },
    ]);
    expect(outcome).toEqual({ jobs: [], errors: [] });
  });
});
