// The rules this engine encodes were each paid for by a wrong row on a list:
// a mobile job at 83%, a QA job at 100%, a company's age read as a requirement,
// "Germany" read as a demand for German. Every case below is one of those.

import { describe, expect, it } from "vitest";
import {
  analyseJob,
  discipline,
  foreignStack,
  needLanguage,
  primaryLanguage,
  roleFit,
  sponsorship,
  usOnlyRemote,
  stack,
  stackFit,
  yearsRequired,
  outOfReach,
  isFitStale,
  DEFAULT_PROFILE,
  mergeProfile,
} from "@/lib/fit";

describe("stack", () => {
  it("counts a nested term once, longest first", () => {
    const rn = stack("React Native and React");
    expect(rn.byTier.owned).toEqual(["react native"]);
    expect(rn.byTier.supporting).toEqual(["react"]);
    expect(stack("Spring Boot").byTier.alien).toHaveLength(1);
    expect(stack("Docker Compose").byTier.strong).toHaveLength(1);
  });

  it("knows what the person does NOT have, so it lands in the denominator", () => {
    const node = stack("TypeScript, Next.js, Fastify, Postgres (Drizzle), BullMQ, Redis, Turborepo");
    expect(node.byTier.alien).toContain("fastify");
    expect(node.byTier.core ?? []).toHaveLength(0);
  });

  it("refuses a percentage on a small denominator", () => {
    expect(stackFit("REST APIs, Git, Agile, CI/CD, best practices").pct).toBeNull();
    expect(stackFit("").pct).toBeNull();
    expect(stackFit("Python").pct).toBeNull();
  });

  it("scores a matching stack high and a foreign one low", () => {
    expect(stackFit("Python, FastAPI, PostgreSQL, Celery, Docker").pct!).toBeGreaterThan(90);
    expect(stackFit("Java 17, Spring Boot, Hibernate, Maven, PostgreSQL").pct!).toBeLessThan(35);
  });
});

describe("discipline", () => {
  it("reads the body, not the title", () => {
    const expo = discipline("Software Engineer", "Tech Stack: Expo + React Native, React, TypeScript, Kotlin, SQL");
    expect(expo.discipline).toBe("mobile");
    const java = discipline("Senior Backend Engineer", "Java 17, Spring Boot, Hibernate, Maven, PostgreSQL");
    expect(java.discipline).toBe("backend");
  });

  it("does not turn a backend job into devops over one Docker mention", () => {
    const be = discipline("Senior Python Engineer", "Python, FastAPI, Docker, Kubernetes, backend services");
    expect(be.discipline).toBe("backend");
  });

  it("leaves the unclear unclear instead of dropping it", () => {
    expect(discipline("Software Engineer", "We move fast and care about craft.").discipline).toBe("unknown");
  });
});

describe("primaryLanguage", () => {
  it("takes the language named first as the language of the work", () => {
    expect(primaryLanguage("6+ years of backend development. We're using Java, Go, Spring boot, GQL, etc.")).toMatchObject({ name: "Java", mine: false });
    expect(primaryLanguage("Python, FastAPI, and some legacy Java services")!.name).toBe("Python");
    expect(primaryLanguage("Our stack is composed of Rails, TypeScript, Java")!.name).toBe("Ruby");
    expect(primaryLanguage("Spring Boot services, plus some Python tooling")!.name).toBe("Java");
    expect(primaryLanguage("Django and Celery")!.name).toBe("Python");
  });

  it("does not invent a language", () => {
    expect(primaryLanguage("We move fast")).toBeNull();
    expect(primaryLanguage("We go fast and ship often")).toBeNull();
    expect(primaryLanguage("JavaScript and TypeScript")!.name).toBe("JavaScript");
  });

  it("recognises Go only where it is the language", () => {
    expect(primaryLanguage("Backend in Go and Rust")!.name).toBe("Go");
    expect(primaryLanguage("Golang microservices")!.name).toBe("Go");
  });
});

describe("roleFit", () => {
  const fit = (t: string) => roleFit(t).fit;

  it("accepts the target roles", () => {
    expect(fit("Senior Python Engineer")).toBe("yes");
    expect(fit("Engineering Manager, Platform")).toBe("yes");
    expect(fit("Senior Backend Engineer")).toBe("yes");
    expect(fit("Business Analyst")).toBe("yes");
    expect(fit("Системный аналитик")).toBe("yes");
    expect(fit("Ведущий Python-разработчик")).toBe("yes");
  });

  it("rejects a familiar stack doing somebody else's job", () => {
    expect(fit("DevOps & QA Engineer")).toBe("no");
    expect(fit("Site Reliability Engineer")).toBe("no");
    expect(fit("Remote Coding Tutor")).toBe("no");
    expect(fit("Data Analyst")).toBe("no");
    expect(fit("Тестировщик")).toBe("no");
    expect(fit("Senior AQA Python (Platform V)")).toBe("no");
    expect(fit("Стажер - инженер по тестированию Python")).toBe("no");
  });

  it("rejects a foreign stack or platform named in the title", () => {
    expect(roleFit("Senior Backend Engineer (Java)")).toEqual({ fit: "no", reason: "stack" });
    expect(roleFit("Drupal/CMS Technical Lead")).toEqual({ fit: "no", reason: "platform" });
    expect(fit("Senior Shopify Full Stack Developer")).toBe("no");
    // A bare language name in a title IS the language, whatever the alphabet
    // around it: "Ведущий Go-разработчик" used to pass as a target role.
    expect(fit("Ведущий Go-разработчик")).toBe("no");
    expect(fit("Senior Go Engineer")).toBe("no");
    expect(fit("C++ Software Engineer")).toBe("no");
    expect(fit("Senior Full Stack Developer (React+Wordpress)")).toBe("no");
  });

  it("keeps applied AI while dropping research ML", () => {
    expect(fit("AI/ML Engineer")).toBe("yes");
    expect(fit("Applied AI Engineer")).toBe("yes");
    expect(fit("Machine Learning Research Scientist")).toBe("no");
  });

  it("drops a posting written in a script the person cannot read", () => {
    expect(fit("愛知勤務｜業務系システム開発エンジニア")).toBe("no");
    expect(fit("Backend Engineer（東京）")).toBe("yes");
  });

  it("says unclear rather than guessing", () => {
    expect(fit("Growth Marketer")).toBe("unclear");
    expect(fit("")).toBe("unclear");
  });
});

describe("years required", () => {
  it("reads a demand made of the reader", () => {
    expect(yearsRequired("5+ years of professional Python experience")).toBe(5);
    expect(yearsRequired("Minimum 8 years of backend development")).toBe(8);
    expect(yearsRequired("We require at least ten years of experience")).toBe(10);
    expect(yearsRequired("Qualifications: 10+ years of experience developing modern web applications")).toBe(10);
    expect(yearsRequired("12+ years of backend engineering")).toBe(12);
  });

  it("takes the lower bound of a range", () => {
    expect(yearsRequired("8-10 years of hands-on experience")).toBe(8);
    expect(yearsRequired("3 to 5 years of experience with FastAPI")).toBe(3);
  });

  it("ignores a company talking about itself", () => {
    expect(yearsRequired("Our team has 30 years of combined experience building payments.")).toBeNull();
    expect(yearsRequired("Founded 20 years ago, we serve customers worldwide.")).toBeNull();
    expect(yearsRequired("With over 20 years of experience in design, development, and quality assurance, Teravision Technologies offers custom solutions")).toBeNull();
    expect(yearsRequired("Here we are 25 years later, having pioneered an industry")).toBeNull();
    expect(yearsRequired("The contract runs for 2 years.")).toBeNull();
  });

  it("separates the brag from the requirement in the same text", () => {
    expect(yearsRequired("We have 30 years of combined experience. You bring 6+ years of Python experience.")).toBe(6);
  });

  it("treats silence as null, not zero", () => {
    expect(yearsRequired("Senior Python Engineer")).toBeNull();
    expect(yearsRequired("")).toBeNull();
  });

  it("calls a bar out of reach only past the stretch", () => {
    expect(outOfReach("15+ years of experience required")).toBe(15);
    expect(outOfReach("10 years of professional experience")).toBe(10);
    expect(outOfReach("8+ years of experience")).toBeNull();
  });
});

describe("foreign language", () => {
  it("needs a word about commanding the language, not about the market", () => {
    expect(needLanguage("Business-level Japanese is required for this role")).toBe("Japanese");
    expect(needLanguage("Fluent German, spoken and written")).toBe("German");
    expect(needLanguage("Experience with the Japanese market is helpful")).toBeNull();
    expect(needLanguage("We serve customers across Germany and the DACH region")).toBeNull();
  });

  it("ignores a language offered as a perk", () => {
    expect(needLanguage("Benefits: English & Spanish conversational classes")).toBeNull();
    expect(needLanguage("German language skills are a plus")).toBeNull();
  });

  it("counts JLPT on its own", () => {
    expect(needLanguage("JLPT N2 or above")).toBe("Japanese");
  });

  it("stays silent about the languages the person speaks", () => {
    expect(needLanguage("Fluent English, spoken and written")).toBeNull();
    const noRussian = mergeProfile({ knownLanguages: ["English"] });
    expect(needLanguage("Native Russian speaker required", noRussian)).toBe("Russian");
  });
});

describe("foreign stack in the body", () => {
  it("reads a demand, not a mention", () => {
    expect(foreignStack("Our tech stack is built primarily with PHP")).toBe("PHP");
    expect(foreignStack("Strong experience with Java and Spring")).toBe("Java");
    expect(foreignStack("Kotlin is a nice to have")).toBeNull();
  });

  it("reads cleaned text: an image URL is not a requirement", () => {
    expect(foreignStack('Strong experience required <img src="https://x.test/a?ixlib=rails-4">')).toBeNull();
  });
});

describe("sponsorship", () => {
  it("separates a work permit from a moving allowance", () => {
    expect(sponsorship("We sponsor visas for the right candidate")).toBe("yes");
    expect(sponsorship("Must be legally authorized to work in the US")).toBe("no");
    expect(sponsorship("We offer a relocation package")).toBeNull();
  });
});

describe("usOnlyRemote", () => {
  it("reads a US city beside the word remote as a closed door", () => {
    // Without a US work permit these are not remote jobs, they are jobs in a
    // country the person cannot work in — and they read identically until the
    // city is looked at. "Remote • Palo Alto" is how Wellfound writes one.
    expect(usOnlyRemote("Remote (US)")).toBe(true);
    expect(usOnlyRemote("Remote • Palo Alto")).toBe(true);
    expect(usOnlyRemote("Remote, Austin, TX")).toBe(true);
    expect(usOnlyRemote("Remote - United States")).toBe(true);
  });

  it("keeps the postings that are open to the person", () => {
    expect(usOnlyRemote("Remote")).toBe(false);
    expect(usOnlyRemote("Remote, Toronto, ON")).toBe(false);
    expect(usOnlyRemote("Remote (Worldwide)")).toBe(false);
    // Said out loud that anywhere will do: the American office is a
    // headquarters, not a restriction.
    expect(usOnlyRemote("Remote anywhere · HQ in New York")).toBe(false);
    // Not remote at all — a Berlin-reachable US office is a different question,
    // and answering it here would make every American address a blocker.
    expect(usOnlyRemote("New York, NY")).toBe(false);
    expect(usOnlyRemote("")).toBe(false);
  });

  it("does not read a state code out of an ordinary word", () => {
    // Bare "ON" turns "hands-on" into Ontario and "IN" into Indiana; the code
    // counts only after a comma, where an address puts it.
    expect(usOnlyRemote("Remote, hands-on delivery team")).toBe(false);
  });
});

describe("analyseJob", () => {
  it("names every reason a posting is not the job", () => {
    const expo = analyseJob({
      title: "Software Engineer",
      description: "Tech Stack: Expo + React Native, React, TypeScript, Kotlin, SQL",
    });
    expect(expo.discipline).toBe("mobile");
    expect(expo.blockers).toContain("mobile");
    expect(expo.pct).toBeNull();
  });

  it("blocks a perfect stack that cannot be worked from here", () => {
    const usRemote = analyseJob({
      title: "Senior Backend Engineer",
      description: "Python, FastAPI, PostgreSQL, Celery, RabbitMQ, Docker.",
      location: "Remote, Austin, TX",
    });
    expect(usRemote.usOnlyRemote).toBe(true);
    expect(usRemote.blockers).toContain("US-only remote");
    // The stack still measures high — the blocker is about geography, and
    // conflating the two would hide why the row is out.
    expect(usRemote.pct!).toBeGreaterThan(90);
  });

  it("leaves a matching posting with no reasons at all", () => {
    const mine = analyseJob({
      title: "Senior Backend Engineer",
      description: "Python, FastAPI, PostgreSQL, Celery, RabbitMQ, Docker. Backend services at scale.",
    });
    expect(mine.discipline).toBe("backend");
    expect(mine.blockers).toEqual([]);
    expect(mine.pct!).toBeGreaterThan(90);
    expect(mine.role).toBe("yes");
  });

  it("drops a posting on the language named first", () => {
    const first = analyseJob({
      title: "Senior Backend Engineer",
      description: "6+ years of backend development. We're using Java, Go, Spring boot, GQL, etc.",
    });
    expect(first.primary).toBe("Java");
    expect(first.blockers.some((b) => /Java/.test(b))).toBe(true);
  });

  it("drops a posting on years out of reach", () => {
    const old = analyseJob({
      title: "Principal Engineer",
      description: "Your profile: 15+ years of experience. Python, FastAPI, PostgreSQL, Docker.",
    });
    expect(old.yearsRequired).toBe(15);
    expect(old.blockers).toContain("15y required");
  });

  it("goes stale when the profile moves under it", () => {
    const desc = "Kubernetes, Terraform, Python, FastAPI, PostgreSQL, Docker.";
    const stored = analyseJob({ title: "Senior Backend Engineer", description: desc });
    expect(isFitStale(stored, desc, DEFAULT_PROFILE)).toBe(false);
    // Moving one technology between tiers rewrites the percentage while the
    // rules version and the description length stand still. Keyed on those two
    // alone, "Profile saved" rebuilt nothing at all.
    const promoted = mergeProfile({
      tiers: { ...DEFAULT_PROFILE.tiers, core: [...DEFAULT_PROFILE.tiers.core, "kubernetes"] },
    });
    expect(isFitStale(stored, desc, promoted)).toBe(true);
  });

  it("follows the profile, not the code", () => {
    const goShop = mergeProfile({
      tiers: { ...DEFAULT_PROFILE.tiers, core: ["go", "golang"], alien: ["python", "django"] },
      targetDisciplines: ["backend"],
    });
    const fit = stackFit("Golang services with Postgres, Redis, Docker", goShop);
    expect(fit.pct!).toBeGreaterThan(90);
  });
});
