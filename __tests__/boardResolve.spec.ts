import { resolveRipplingBoard } from "@/lib/scraper/rippling";
import { resolveWorkableBoard } from "@/lib/scraper/workable";
import { resolveSmartRecruitersBoard } from "@/lib/scraper/smartrecruiters";
import { resolvePersonioBoard } from "@/lib/scraper/personio";
import { resolveRecruiteeBoard } from "@/lib/scraper/recruitee";
import { boardsOfKind } from "@/lib/scraper/boards";
import { ATS_PROVIDERS } from "@/lib/scraper/ats/registry";

// Every companies board's wizard copy ends "or paste a <host> link or token",
// and for five of them the save boundary answered that link with "Paste a
// <board> board token" — it tested the whole URL against the bare-slug
// allowlist, which a string with dots and slashes in it can never pass. The
// only input that worked was a slug the user had no way to learn.

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: { cancel: () => {} },
  } as unknown as Response;
}

function okText(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

afterEach(() => vi.restoreAllMocks());

describe("Rippling resolve", () => {
  it("takes the slug out of a pasted board link", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/jobs")
        ? okJson([{ uuid: "abc", url: "https://ats.rippling.com/chess/jobs/abc" }])
        : okJson({ companyName: "Chess.com" }),
    );

    await expect(
      resolveRipplingBoard("https://ats.rippling.com/chess/jobs"),
    ).resolves.toEqual({ success: true, name: "Chess.com", token: "chess" });
  });

  // humanizeToken('chess') is "Chess"; the board belongs to Chess.com, and the
  // detail is the only place that says so.
  it("prefers the employer's own name from the detail over the slug", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/jobs")
        ? okJson([{ uuid: "abc", url: "https://ats.rippling.com/chess/jobs/abc" }])
        : okJson({ companyName: "Chess.com" }),
    );

    const result = await resolveRipplingBoard("chess");
    expect(result).toMatchObject({ success: true, name: "Chess.com" });
  });

  it("falls back to the humanized slug when the board has nothing open", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson([]));
    await expect(resolveRipplingBoard("acme-labs")).resolves.toEqual({
      success: true,
      name: "Acme Labs",
      token: "acme-labs",
    });
  });

  it("reports an unknown board rather than saving a watchlist entry for it", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({}, 404));
    const result = await resolveRipplingBoard("nosuchboard");
    expect(result).toMatchObject({ success: false });
  });

  it("refuses another board's link instead of reading it as a slug", async () => {
    const spy = vi.spyOn(global, "fetch");
    const result = await resolveRipplingBoard("https://jobs.ashbyhq.com/ramp");
    expect(result).toMatchObject({ success: false });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Workable resolve", () => {
  it("takes the slug out of a deep posting link", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ total: 16 }));
    await expect(
      resolveWorkableBoard("https://apply.workable.com/action1/j/F6C5107433/"),
    ).resolves.toEqual({ success: true, name: "Action1", token: "action1" });
  });

  it("reports an unknown board", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({}, 404));
    await expect(resolveWorkableBoard("nosuchboard")).resolves.toMatchObject({
      success: false,
    });
  });
});

describe("SmartRecruiters resolve", () => {
  // Slugs are capitalised here, and the stored token is what every posting URL
  // is built from — so lowercasing the capture would change the links.
  it("keeps the slug's case and takes the employer's name off a posting", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ totalFound: 93, content: [{ company: { name: "Mirantis" } }] }),
    );
    await expect(
      resolveSmartRecruitersBoard("https://jobs.smartrecruiters.com/Mirantis"),
    ).resolves.toEqual({ success: true, name: "Mirantis", token: "Mirantis" });
  });

  // An unknown company answers 200 with totalFound 0, exactly as a real
  // employer with nothing open does, and there is no other endpoint to ask.
  it("accepts an empty board rather than calling every quiet employer a typo", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ totalFound: 0, content: [] }),
    );
    await expect(resolveSmartRecruitersBoard("Acumatica")).resolves.toEqual({
      success: true,
      name: "Acumatica",
      token: "Acumatica",
    });
  });
});

describe("Personio resolve", () => {
  it("takes the slug out of a pasted board link", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okText("<workzag-jobs><position></position></workzag-jobs>"),
    );
    await expect(
      resolvePersonioBoard("https://vivid.jobs.personio.de/job/2781380"),
    ).resolves.toEqual({ success: true, name: "Vivid", token: "vivid" });
  });

  // An unknown subdomain answers 307 to personio.com's marketing site, which is
  // a perfectly good 200 HTML page with no <position> in it. Chased, a typo
  // would resolve as a real board with nothing open.
  it("reads the redirect as a missing board, not as an empty one", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okText("", 307));
    await expect(resolvePersonioBoard("nosuchboard")).resolves.toMatchObject({
      success: false,
    });
  });
});

describe("Recruitee resolve", () => {
  it("takes the employer's own name off an offer", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJson({ offers: [{ company_name: "Laborde Earles" }] }),
    );
    await expect(
      resolveRecruiteeBoard("https://labordeearles.recruitee.com/"),
    ).resolves.toEqual({
      success: true,
      name: "Laborde Earles",
      token: "labordeearles",
    });
  });

  it("falls back to the humanized slug on a board with nothing open", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okJson({ offers: [] }));
    await expect(resolveRecruiteeBoard("wallarm")).resolves.toMatchObject({
      name: "Wallarm",
    });
  });
});

// The wizard offers "add by board link" on every companies board. A board with
// neither a resolve() nor a directory to search leaves the user guessing a bare
// slug, which is the state the five phase-5 boards shipped in.
describe("every companies board", () => {
  it("can be added by link, or is one of the three the action resolves itself", () => {
    const inAction = ["greenhouse", "lever", "ashby"];
    boardsOfKind("companies").forEach((board) => {
      if (inAction.includes(board.id)) return;
      const provider = ATS_PROVIDERS[board.id];
      expect(
        provider?.kind === "companies" && provider.resolve,
        `${board.id} promises "${board.wizard.urlHint}" but has no resolve()`,
      ).toBeTruthy();
    });
  });
});
