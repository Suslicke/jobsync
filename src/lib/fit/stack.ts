// What stack a posting uses and what job it is are two different questions,
// and one percentage answers neither well.
//
// "Expo + React Native, React, TypeScript, Kotlin, SQL" scored 83%: almost
// everything is formally on the résumé. But it is mobile work. Same disease as
// "DevOps & QA Engineer — 100%": a share of familiar words standing in for
// whether the role fits at all.
//
// `stack()` returns the technologies grouped by distance from the person, so
// they can be shown as tags and judged by a human. `discipline()` answers whose
// job it is from the body of the posting, not from its title.

import {
  DEFAULT_PROFILE,
  MIN_TERMS,
  TIER_WEIGHT,
  escapeRe,
  type FitProfile,
  type FitTier,
} from "./profile";

export type StackTerm = { term: string; tier: FitTier; weight: number };
export type StackResult = {
  terms: StackTerm[];
  byTier: Partial<Record<FitTier, string[]>>;
};
export type StackFit = StackResult & { pct: number | null; scored: number };

// Word boundaries are not `\b`: ".net" and "c++" neither start nor end with a
// letter, and `\b` would refuse to match them.
const termRe = (term: string) =>
  new RegExp(`(?<![a-z0-9+#.])${escapeRe(term)}(?![a-z0-9+#])`, "i");

// Bare "go" matches "we go fast" and "go-to-market", and it now costs as much
// as a core term gains. It is recognised only where it really is a language.
const RE_OVERRIDE: Record<string, RegExp> = {
  go: /(?<![a-z0-9])go(?=\s*(?:developer|engineer|programmer|lang|routines?|modules?|services?|microservices?|backend|\d))|(?<=[,/|(]\s?)go(?=\s*[,/|)])|(?<![a-z0-9])go(?=\s*(?:and|,)\s*(?:rust|java|python|kotlin|scala))/i,
};

type Compiled = { all: StackTerm[]; re: Map<string, RegExp> };
// Compiling ~400 regexes per call would be silly; a profile object is stable
// for the life of a request, so memoising on identity is enough.
const compiledCache = new WeakMap<FitProfile, Compiled>();

function compile(profile: FitProfile): Compiled {
  const cached = compiledCache.get(profile);
  if (cached) return cached;
  // Longest first, and not as decoration: without it "React Native" counts both
  // as react native and as react, and "Spring Boot" lands in the alien tier
  // twice. Matches are cut out of the text so nested terms cannot re-match.
  const all = (Object.entries(profile.tiers) as [FitTier, string[]][])
    .flatMap(([tier, list]) =>
      list.map((term) => ({ term, tier, weight: TIER_WEIGHT[tier] })),
    )
    .sort((a, b) => b.term.length - a.term.length);
  const re = new Map(all.map((t) => [t.term, RE_OVERRIDE[t.term] ?? termRe(t.term)]));
  const value = { all, re };
  compiledCache.set(profile, value);
  return value;
}

/** Technologies of a posting, grouped by distance. Nested terms count once. */
export function stack(text: unknown, profile: FitProfile = DEFAULT_PROFILE): StackResult {
  let rest = String(text ?? "");
  if (!rest.trim()) return { terms: [], byTier: {} };
  const { all, re } = compile(profile);
  const terms: StackTerm[] = [];
  for (const t of all) {
    const m = rest.match(re.get(t.term)!);
    if (!m || m.index === undefined) continue;
    terms.push(t);
    // Blank the match out rather than flag it: the next, shorter term must not
    // see these same letters.
    rest =
      rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length);
  }
  const byTier: Partial<Record<FitTier, string[]>> = {};
  for (const t of terms) (byTier[t.tier] ??= []).push(t.term);
  return { terms, byTier };
}

/**
 * Share of the posting's stack the person already has, weighted.
 * `null` means not measured: no description, or too few meaningful terms.
 */
export function stackFit(text: unknown, profile: FitProfile = DEFAULT_PROFILE): StackFit {
  const { terms, byTier } = stack(text, profile);
  let mine = 0;
  let theirs = 0;
  let scored = 0;
  for (const t of terms) {
    if (t.tier === "neutral" || t.tier === "owned") continue; // neither side
    scored++;
    if (t.tier === "core" || t.tier === "strong" || t.tier === "supporting") mine += t.weight;
    else theirs += t.weight;
  }
  const pct = scored >= MIN_TERMS ? Math.round((100 * mine) / (mine + theirs)) : null;
  return { pct, scored, byTier, terms };
}

/* ------------------------------------------------ the first language named */

// Order inside this list does not matter; what matters is whose name appears
// EARLIER in the posting. A framework names its language as well as the
// language does: "Our stack is composed of Rails, TypeScript, Java" starts
// with Ruby even though the word ruby never appears.
const LANGS: [string, RegExp][] = [
  ["Python", /(?<![a-z0-9])(python3?|django|fastapi|flask)(?![a-z0-9])/i],
  ["TypeScript", /(?<![a-z0-9])typescript(?![a-z0-9])/i],
  ["JavaScript", /(?<![a-z0-9])javascript(?![a-z0-9])/i],
  ["Java", /\b(java\b(?!script)|spring boot|springboot|hibernate|quarkus)/i],
  ["Go", RE_OVERRIDE.go],
  ["C#", /(?<![a-z0-9])(c#|asp\.net|blazor)/i],
  [".NET", /(?<![a-z0-9])\.net(?![a-z0-9])/i],
  ["PHP", /\b(php|laravel|symfony)\b/i],
  ["Ruby", /\b(ruby|rails)\b/i],
  ["Kotlin", /\bkotlin\b/i],
  ["Scala", /\bscala\b(?!ble)/i],
  ["Swift", /\b(swift|swiftui)\b/i],
  ["C++", /(?<![a-z0-9])c\+\+/i],
  ["Rust", /\brust\b/i],
  ["Elixir", /\b(elixir|phoenix)\b/i],
  ["Perl", /\bperl\b/i],
];

// Which of those languages the person writes is a property of the profile:
// a language is "mine" when its name sits in a tier that is not alien.
function isMine(language: string, profile: FitProfile): boolean {
  const alien = new Set(profile.tiers.alien.map((t) => t.toLowerCase()));
  const key = language.toLowerCase();
  if (alien.has(key)) return false;
  const owned = [
    ...profile.tiers.core,
    ...profile.tiers.strong,
    ...profile.tiers.supporting,
  ].map((t) => t.toLowerCase());
  return owned.includes(key);
}

/**
 * The language named FIRST in the posting, and whether it is the person's.
 *
 * "6+ years of backend development. We're using Java, Go, Spring boot, GQL" —
 * the order is not accidental: the language the work is in gets written first.
 * Asking "is a foreign language mentioned anywhere" stays silent here whenever
 * Python appears further down; asking "which came first" answers correctly.
 */
export function primaryLanguage(
  text: unknown,
  profile: FitProfile = DEFAULT_PROFILE,
): { name: string; at: number; mine: boolean } | null {
  const s = String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  let best: { name: string; at: number; mine: boolean } | null = null;
  for (const [name, re] of LANGS) {
    const m = s.match(re);
    if (!m || m.index === undefined) continue;
    if (best === null || m.index < best.at)
      best = { name, at: m.index, mine: isMine(name, profile) };
  }
  return best;
}

/* --------------------------------------------------------- whose job it is */

const MARK: Record<string, [string, number][]> = {
  backend: [
    ["backend", 3], ["back-end", 3], ["server-side", 3], ["distributed systems", 3],
    ["message queue", 3], ["event-driven architecture", 3], ["high throughput", 3],
    ["low latency", 3], ["api design", 3], ["database schema", 3],
    ["query optimization", 3], ["background jobs", 3], ["worker queue", 3],
    ["caching", 1], ["indexing", 1], ["orm", 1],
  ],
  fullstack: [
    ["full-stack", 3], ["full stack", 3], ["fullstack", 3], ["across the stack", 3],
    ["frontend and backend", 3], ["end-to-end ownership", 2],
  ],
  frontend: [
    ["frontend", 3], ["front-end", 3], ["user interface", 3], ["design system", 3],
    ["responsive design", 3], ["web vitals", 3], ["wcag", 3], ["pixel-perfect", 3],
    ["single-page application", 3], ["component library", 3], ["figma", 2],
  ],
  mobile: [
    ["mobile app", 3], ["ios app", 3], ["android app", 3], ["app store", 3],
    ["google play", 3], ["mobile developer", 3], ["mobile engineer", 3],
    ["push notification", 1],
  ],
  data: [["data engineer", 3], ["data pipeline", 3], ["data warehouse", 3], ["etl", 2]],
  // Two different professions that must not be mixed. APPLYING models is a
  // Python backend around someone else's API: integrations, retrieval, agents,
  // inference under load. TRAINING models is PyTorch and mathematics.
  ai: [
    ["llm", 3], ["large language model", 3], ["rag", 3], ["retrieval-augmented", 3],
    ["retrieval augmented", 3], ["prompt engineering", 3], ["ai agent", 3],
    ["agentic", 3], ["vector database", 3], ["embeddings", 2], ["openai", 2],
    ["anthropic", 2], ["langchain", 2], ["llamaindex", 2], ["inference", 1],
    ["ai engineer", 3],
  ],
  ml: [
    ["machine learning engineer", 3], ["model training", 3], ["deep learning", 3],
    ["computer vision", 3], ["data scientist", 3], ["pytorch", 2], ["tensorflow", 2],
    ["feature engineering", 2], ["research scientist", 3],
  ],
  devops: [
    ["devops", 3], ["site reliability", 3], ["platform engineer", 3],
    ["infrastructure engineer", 3], ["on-call rotation", 2], ["incident response", 1],
  ],
  qa: [["qa engineer", 3], ["test automation", 3], ["sdet", 3], ["manual testing", 3]],
  embedded: [["embedded", 3], ["firmware", 3], ["bare metal", 3], ["real-time operating", 3]],
};

// Evidence from the stack itself — this is what catches a posting whose title
// says nothing at all.
const FROM_TIER: Partial<Record<FitTier, [string, number]>> = {
  core: ["backend", 2],
  owned: ["mobile", 2],
};
const ALIEN_HINT: [RegExp, string, number][] = [
  [/^(pytorch|tensorflow|keras|scikit-learn|sklearn|xgboost|lightgbm|hugging face|transformers|cuda|mlflow|kubeflow|sagemaker|vertex ai|fine-tuning|model training|deep learning|neural network|computer vision|opencv|nlp|spacy|nltk)$/, "ml", 2],
  [/^(spark|pyspark|hadoop|hive|flink|airflow|dagster|prefect|dbt|snowflake|redshift|bigquery|databricks|tableau|power bi|looker|data warehouse|data lake|star schema|etl|debezium)$/, "data", 2],
  [/^(jetpack compose|ionic|cordova|capacitor|xcode|android studio|swift|swiftui|objective-c|kotlin)$/, "mobile", 2],
  [/^(verilog|vhdl|rtos|freertos|arduino|esp32|stm32|plc|scada|can bus|modbus|firmware|embedded c)$/, "embedded", 2],
];
const ADJ_HINT: [RegExp, string, number][] = [
  [/^(kubernetes|k8s|helm|argocd|terraform|pulumi|ansible|jenkins|circleci|istio|vault)$/, "devops", 1],
  [/^(cypress|playwright|selenium|puppeteer|k6|locust)$/, "qa", 1],
  [/^(react|vue|next\.js|nextjs|tailwind|redux|storybook|svelte|nuxt)$/, "frontend", 1],
];

const TRACK: [string, RegExp][] = [
  ["manager", /\b(engineering manager|head of engineering|director of engineering|vp of engineering|people manage|manage a team|hiring|performance review)\b/i],
  ["lead", /\b(tech(nical)? lead|team lead|lead engineer|staff engineer|principal engineer|mentor)\b/i],
];

export type DisciplineResult = {
  discipline: string;
  also: string[];
  track: string;
  points: Record<string, number>;
  margin: number;
};

/**
 * Whose job this is. The title weighs double: one line, but a precise one.
 * 'unknown' is an honest "cannot tell" and is NOT grounds for dropping a
 * posting — what is unclear goes to a human instead of the bin.
 */
export function discipline(
  title: unknown,
  text: unknown = "",
  profile: FitProfile = DEFAULT_PROFILE,
): DisciplineResult {
  const t = String(title ?? "");
  const body = `${t}\n${String(text ?? "")}`;
  const pts: Record<string, number> = {};
  const add = (k: string, n: number) => {
    pts[k] = (pts[k] || 0) + n;
  };

  for (const [kind, marks] of Object.entries(MARK)) {
    for (const [phrase, w] of marks) {
      const re = new RegExp(`(?<![a-z0-9])${escapeRe(phrase)}(?![a-z0-9])`, "i");
      if (re.test(t)) add(kind, w * 2);
      else if (re.test(body)) add(kind, w);
    }
  }
  const { terms } = stack(body, profile);
  for (const x of terms) {
    const direct = FROM_TIER[x.tier];
    if (direct) add(direct[0], direct[1]);
    const table = x.tier === "alien" ? ALIEN_HINT : x.tier === "adjacent" ? ADJ_HINT : null;
    if (table) for (const [re, kind, w] of table) if (re.test(x.term)) add(kind, w);
  }

  const sorted = Object.entries(pts).sort((a, b) => b[1] - a[1]);
  const [top, second] = [sorted[0], sorted[1]];
  const kind = top && top[1] >= 3 ? top[0] : "unknown";
  const also = sorted
    .filter(([k, v]) => k !== kind && top && v >= top[1] - 2 && v >= 3)
    .map(([k]) => k);
  let track = "ic";
  for (const [name, re] of TRACK)
    if (re.test(body)) {
      track = name;
      break;
    }
  return {
    discipline: kind,
    also,
    track,
    points: pts,
    margin: top && second ? top[1] - second[1] : top ? top[1] : 0,
  };
}
