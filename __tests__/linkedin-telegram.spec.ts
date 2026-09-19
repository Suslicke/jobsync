import { APP_CONSTANTS } from "@/lib/constants";
import { GuestPacer } from "@/lib/scraper/linkedin/pace";
import {
  guestSearchUrl,
  jobIdFromUrl,
  pageStart,
  parseGuestCards,
  parseJobPosting,
} from "@/lib/scraper/linkedin/parse";
import {
  decodePost,
  parseChannelPage,
  parseHashtagPost,
  parseHeadlinePost,
  parseLabelledPost,
  parsePost,
  channelPageUrl,
} from "@/lib/scraper/telegram/parse";

// Trimmed from a live seeMoreJobPostings response (19.09.2026): one <li> per
// card, the id in data-entity-urn, everything else keyed off class names.
const GUEST_CARD = `<!DOCTYPE html>
  <li><div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:4390721897">
  <a class="base-card__full-link" href="https://ca.linkedin.com/jobs/view/senior-backend-at-acme-4390721897?position=1&amp;refId=xyz"></a>
  <h3 class="base-search-card__title">
        Senior Backend Engineer
      </h3><h4 class="base-search-card__subtitle"><a class="hidden-nested-link">ACME &amp; Co</a></h4>
  <span class="job-search-card__location">Calgary, Alberta, Canada</span>
  <time datetime="2026-09-16"></time></div></li>`;

// The fragment jobPosting/<id> returns, with only two of its four criteria
// pairs present — which is the normal case, not an edge one.
const POSTING_FRAGMENT = `<h2 class="topcard__title">Senior Backend Engineer</h2>
  <div class="show-more-less-html__markup relative"><p>We need <strong>Python</strong> &amp; FastAPI.</p><ul><li>Docker</li></ul></div>
  <ul class="description__job-criteria-list">
    <li><h3 class="description__job-criteria-subheader"> Employment type </h3>
      <span class="description__job-criteria-text description__job-criteria-text--criteria"> Full-time </span></li>
    <li><h3 class="description__job-criteria-subheader"> Industries </h3>
      <span class="description__job-criteria-text description__job-criteria-text--criteria"> Financial Services </span></li>
  </ul>`;

describe("parseGuestCards", () => {
  it("reads every field off one card", () => {
    const [card] = parseGuestCards(GUEST_CARD);
    expect(card.id).toBe("4390721897");
    expect(card.title).toBe("Senior Backend Engineer");
    expect(card.company).toBe("ACME & Co");
    expect(card.location).toBe("Calgary, Alberta, Canada");
    expect(card.postedDate).toBe("2026-09-16");
  });

  it("drops the tracking query from the posting link", () => {
    const [card] = parseGuestCards(GUEST_CARD);
    // position/refId/trackingId change on every fetch, so keeping them would
    // hand the same posting a different dedup key each run.
    expect(card.url).toBe(
      "https://ca.linkedin.com/jobs/view/senior-backend-at-acme-4390721897",
    );
  });

  it("falls back to the canonical posting URL when the card has no link", () => {
    const noLink = GUEST_CARD.replace(/<a class="base-card__full-link"[^>]*>/, "");
    expect(parseGuestCards(noLink)[0].url).toBe(
      `${APP_CONSTANTS.LINKEDIN_JOB_URL}/4390721897`,
    );
  });

  it("skips list items that are not postings", () => {
    // The end-of-results filler is an <li> with no urn and no title.
    expect(parseGuestCards(`<li><div class="see-more"></div></li>`)).toHaveLength(0);
    expect(parseGuestCards("<!DOCTYPE html>")).toHaveLength(0);
    const titleless = GUEST_CARD.replace(
      /<h3 class="base-search-card__title">[\s\S]*?<\/h3>/,
      "",
    );
    expect(parseGuestCards(titleless)).toHaveLength(0);
  });
});

describe("guestSearchUrl", () => {
  it("sends f_TPR and none of the filters the endpoint ignores", () => {
    const url = guestSearchUrl("Senior Backend Engineer", "Canada", 20);
    expect(url).toContain("f_TPR=r2592000");
    // Verified against the live endpoint: f_WT=2 returns the identical ten
    // posting ids. Sending a filter that does nothing only costs requests.
    expect(url).not.toContain("f_WT");
    expect(url).not.toContain("f_JT");
    expect(url).not.toContain("f_E=");
    expect(url).toContain("start=20");
    expect(url.startsWith(APP_CONSTANTS.LINKEDIN_GUEST_BASE_URL)).toBe(true);
  });
});

describe("pageStart", () => {
  it("steps by ten, because a page is ten cards", () => {
    // A step of 25 never asks for indices 10-24 of any query.
    expect([0, 1, 2].map(pageStart)).toEqual([0, 10, 20]);
  });

  it("stops short of the offset the endpoint rejects", () => {
    // start=1000 is a hard 400, so the last page walked must be below it.
    expect(pageStart(APP_CONSTANTS.LINKEDIN_GUEST_MAX_PAGES - 1)).toBeLessThan(
      1000,
    );
    expect(pageStart(APP_CONSTANTS.LINKEDIN_GUEST_MAX_PAGES)).toBeLessThanOrEqual(
      1000,
    );
  });
});

describe("jobIdFromUrl", () => {
  it("reads the id out of both shapes the search produces", () => {
    expect(
      jobIdFromUrl("https://ca.linkedin.com/jobs/view/senior-backend-at-acme-4390721897"),
    ).toBe("4390721897");
    expect(jobIdFromUrl("https://www.linkedin.com/jobs/view/4390721897")).toBe(
      "4390721897",
    );
  });

  it("returns null rather than a guess when there is no id", () => {
    expect(jobIdFromUrl("https://example.com/careers/backend")).toBeNull();
  });
});

describe("parseJobPosting", () => {
  it("returns the description markup as HTML", () => {
    const detail = parseJobPosting(POSTING_FRAGMENT);
    expect(detail.description).toContain("<strong>Python</strong>");
    expect(detail.description).toContain("<li>Docker</li>");
  });

  it("reads the employment type by its heading, not by its position", () => {
    // This fragment has no "Seniority level" pair at all; a positional read
    // would file "Full-time" under the missing first label.
    expect(parseJobPosting(POSTING_FRAGMENT).employmentType).toBe("Full-time");
  });

  it("returns an empty description for a fragment that has none", () => {
    // The guard the "ok 20" bug needed: a fragment that yielded nothing must
    // say so, not hand back a blank that reads as a loaded description.
    expect(parseJobPosting("<div></div>").description).toBe("");
    expect(parseJobPosting("<div></div>").employmentType).toBe("");
  });
});

describe("GuestPacer", () => {
  it("doubles the interval on a refusal, up to the ceiling", () => {
    const pacer = new GuestPacer();
    expect(pacer.intervalMs).toBe(APP_CONSTANTS.LINKEDIN_GUEST_MIN_INTERVAL_MS);
    pacer.penalise();
    expect(pacer.intervalMs).toBe(
      APP_CONSTANTS.LINKEDIN_GUEST_MIN_INTERVAL_MS * 2,
    );
    for (let i = 0; i < 20; i++) pacer.penalise();
    expect(pacer.intervalMs).toBe(APP_CONSTANTS.LINKEDIN_DESC_MAX_INTERVAL_MS);
  });

  it("recovers one floor-step at a time, never below the floor", () => {
    const pacer = new GuestPacer();
    pacer.penalise();
    pacer.penalise();
    const backedOff = pacer.intervalMs;
    pacer.recover();
    // A single good response must not undo a backoff the source just asked for.
    expect(pacer.intervalMs).toBeLessThan(backedOff);
    expect(pacer.intervalMs).toBeGreaterThan(
      APP_CONSTANTS.LINKEDIN_GUEST_MIN_INTERVAL_MS,
    );
    for (let i = 0; i < 20; i++) pacer.recover();
    expect(pacer.intervalMs).toBe(APP_CONSTANTS.LINKEDIN_GUEST_MIN_INTERVAL_MS);
  });

  it("spaces consecutive takes by the interval", async () => {
    const pacer = new GuestPacer();
    const started = Date.now();
    await pacer.take();
    await pacer.take();
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      APP_CONSTANTS.LINKEDIN_GUEST_MIN_INTERVAL_MS - 50,
    );
  });
});

// Two messages as t.me/s/<channel> serves them: the body and the timestamp live
// in different parts of one message block.
const PREVIEW_PAGE = `<div class="tgme_widget_message" data-post="job_python/7951">
  <div class="tgme_widget_message_text js-message_text" dir="auto"><b>BGStaff</b><br/><b>Python-разработчик</b><br/>Формат работы: удал&#1105;нно</div>
  <span class="tgme_widget_message_meta"><a class="tgme_widget_message_date"><time datetime="2026-09-03T05:00:03+00:00"></time></a></span>
</div>
<div class="tgme_widget_message" data-post="job_python/7952">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Senior Data Analyst в Stellartech<br/>📍 Remote</div>
  <span class="tgme_widget_message_meta"><a class="tgme_widget_message_date"><time datetime="2026-09-04T05:00:03+00:00"></time></a></span>
</div>`;

describe("parseChannelPage", () => {
  it("returns one entry per message with its own timestamp", () => {
    const posts = parseChannelPage(PREVIEW_PAGE);
    expect(posts.map((p) => p.id)).toEqual([7951, 7952]);
    expect(posts[0].postedAt).toBe("2026-09-03T05:00:03+00:00");
    expect(posts[1].postedAt).toBe("2026-09-04T05:00:03+00:00");
  });

  it("skips a message with no text and leaves its neighbour intact", () => {
    // A photo-only post has no text div. Matching body and date with one regex
    // across the whole page staples this post's timestamp to the next post.
    const withPhoto = `<div data-post="job_python/7950">
      <div class="tgme_widget_message_photo"></div>
      <span><time datetime="2026-09-01T05:00:03+00:00"></time></span>
    </div>${PREVIEW_PAGE}`;
    const posts = parseChannelPage(withPhoto);
    expect(posts.map((p) => p.id)).toEqual([7951, 7952]);
    expect(posts[0].postedAt).toBe("2026-09-03T05:00:03+00:00");
  });
});

describe("decodePost", () => {
  it("keeps the line structure the parsers read", () => {
    // flattenHtml would collapse these newlines, and with them the only signal
    // that tells the three post layouts apart.
    expect(decodePost("A<br/>B<br />C")).toBe("A\nB\nC");
  });

  it("decodes the entities telegram escapes", () => {
    expect(decodePost("ForteBank&#33; &amp; Co &quot;X&quot;")).toBe(
      'ForteBank! & Co "X"',
    );
  });
});

describe("telegram post layouts", () => {
  it("labelled: company is required, role falls back to the first plain line", () => {
    const card = parseLabelledPost(
      "Город: Алматы\nКомпания: qBots\nВакансия: Junior Project Manager\nЗарплата: 500 000",
    );
    expect(card).toEqual({
      title: "Junior Project Manager",
      company: "qBots",
      location: "Алматы",
      salary: "500 000",
    });
    // No company label — a note about hiring, not a card for one job.
    expect(parseLabelledPost("Вакансия: Backend Engineer")).toBeNull();
  });

  it("labelled: a hashtag row is not a job title", () => {
    const card = parseLabelledPost(
      "Компания: Acme\n#vacancy #AI #Python #Uzbekistan\nSenior Backend Engineer",
    );
    expect(card?.title).toBe("Senior Backend Engineer");
  });

  it("hashtag: needs the opening hashtag row and a capitalised company", () => {
    const card = parseHashtagPost(
      "#senior #удаленка\nЛига Цифровой Экономики\nВедущий Python-разработчик\nФормат работы: можно удалённо (Москва)",
    );
    expect(card).toEqual({
      title: "Ведущий Python-разработчик",
      company: "Лига Цифровой Экономики",
      location: "можно удалённо (Москва)",
    });
    // Without the signature this parser would make a company and a role out of
    // the first two lines of any post at all.
    expect(parseHashtagPost("Лига\nВедущий разработчик")).toBeNull();
    expect(parseHashtagPost("#senior\nлига\nРазработчик")).toBeNull();
  });

  it("headline: rejects a digest that fits the shape", () => {
    const text = "Дайджест вакансий в Зарубежных стартапах";
    expect(parseHeadlinePost(text, text)).toBeNull();
    const lower = "Работаем в стартапах";
    expect(parseHeadlinePost(lower, lower)).toBeNull();
  });

  it("headline: reads both the Russian and the English joining word", () => {
    expect(parseHeadlinePost("Backend разработчик в WASD.TV", "")?.company).toBe(
      "WASD.TV",
    );
    expect(parseHeadlinePost("Senior Data Analyst at Stellartech", "")?.company).toBe(
      "Stellartech",
    );
  });
});

describe("parsePost", () => {
  const post = (html: string, id = 1) => ({ id, html, postedAt: "2026-09-03T05:00:03+00:00" });

  it("falls through to the labelled layout when the headline shape misfires", () => {
    // "Город: Алматы / гибрид (офис + выезды в поликлиники)" fits the headline
    // shape, fails on "поликлиники)" — and used to take the whole post with it,
    // while three lines below it named the company and the role.
    const job = parsePost(
      post(
        "Город: Алматы / гибрид (офис + выезды в поликлиники)<br/>Компания: qBots<br/>Вакансия: Junior Project Manager",
      ),
      "itvacancykz",
    );
    expect(job?.company).toBe("qBots");
    expect(job?.title).toBe("Junior Project Manager");
  });

  it("reads a headline that follows a hashtag row", () => {
    // Reading this as company-then-role hired "1 200 000 тг" at a company
    // called "CV Engineer (remote) в I2NIK".
    const job = parsePost(
      post("#computervision #python<br/>CV Engineer (remote) в I2NIK<br/>1 200 000 тг"),
      "itvacancykz",
    );
    expect(job?.title).toBe("CV Engineer (remote)");
    expect(job?.company).toBe("I2NIK");
  });

  it("stores the permalink, never a link lifted out of the body", () => {
    // A channel's own footer link matches any "looks like a job board" rule; on
    // job_python it matched on every post, which would have given every job in
    // the channel one identical URL.
    const job = parsePost(
      post(
        `Senior Data Analyst в Stellartech<br/><a href="https://vk.com/job_python">наш VK</a>`,
        7952,
      ),
      "job_python",
    );
    expect(job?.url).toBe("https://t.me/job_python/7952");
  });

  it("carries the post's own text as the description and its date", () => {
    const job = parsePost(post("Backend разработчик в WASD.TV<br/>Стек: Python"), "x");
    expect(job?.description).toContain("Стек: Python");
    expect(job?.postedDate).toBe("2026-09-03T05:00:03+00:00");
  });

  it("returns null for a post that is not a job card", () => {
    expect(parsePost(post("Всем привет, сегодня разбираем офферы"), "x")).toBeNull();
    expect(parsePost(post(""), "x")).toBeNull();
  });
});

describe("channelPageUrl", () => {
  it("omits `before` on the first page and sends it afterwards", () => {
    expect(channelPageUrl("job_python", 0)).toBe(
      `${APP_CONSTANTS.TELEGRAM_BASE_URL}/job_python`,
    );
    expect(channelPageUrl("job_python", 7951)).toBe(
      `${APP_CONSTANTS.TELEGRAM_BASE_URL}/job_python?before=7951`,
    );
  });
});
