// What counts as "my stack" is a property of the person, not of the code.
//
// The matching machinery lives in the other files here; this file holds the
// only thing that differs between users: which technologies are theirs, which
// disciplines they target, how many years they have, which human languages
// they speak. Everything is overridable from Settings, so the fork ships an
// opinionated default rather than a hardcoded truth.

export type FitTier =
  | "core"
  | "strong"
  | "supporting"
  | "neutral"
  | "owned"
  | "adjacent"
  | "alien";

export type SkipGroup = "role" | "stack" | "platform" | "nonSoftware" | "research";

export type FitProfile = {
  /** Technologies grouped by distance from the person. */
  tiers: Record<FitTier, string[]>;
  /** Disciplines worth applying to; anything else is a blocker. */
  targetDisciplines: string[];
  /** Years of experience the person actually has. */
  haveYears: number;
  /** How far above `haveYears` a requirement may sit before it is a wall. */
  yearsStretch: number;
  /** Human languages the person speaks. Others become blockers. */
  knownLanguages: string[];
  /** Title fragments that mean "this is my role". */
  wantRoles: string[];
  /** Checked before the skip lists: a target role whose name looks off. */
  wantRolesPriority: string[];
  /** Title fragments that rule a role out, grouped by reason. */
  skipRoles: Record<SkipGroup, string[]>;
  /** Programming languages the person does not write, with their patterns. */
  foreignStacks: { name: string; pattern: string }[];
};

// Tier weights. Matching a core term says more than matching a supporting one,
// and an alien term costs as much as a core one gains: a Java shop is as wrong
// for a Python engineer as a Python shop is right.
export const TIER_WEIGHT: Record<FitTier, number> = {
  core: 3,
  strong: 2,
  supporting: 1,
  neutral: 0,
  owned: 0,
  adjacent: 1,
  alien: 3,
};

// Below this many scored terms a percentage is not a measurement. A two-line
// Telegram post naming two known technologies would otherwise read as 100%.
export const MIN_TERMS = 4;

/**
 * Default profile: a backend-leaning Python engineer who also does product
 * frontend. Replace it in Settings; nothing in the code assumes these values.
 */
export const DEFAULT_PROFILE: FitProfile = {
  tiers: {
    core: [
      "python", "python3", "fastapi", "django", "django rest framework", "drf",
      "celery", "sqlalchemy", "alembic", "pydantic", "asyncio", "aiohttp", "httpx",
      "starlette", "uvicorn", "gunicorn", "beanie", "arq", "aiogram", "flask",
      "tornado", "sanic", "litestar",
    ],
    strong: [
      "postgresql", "postgres", "mongodb", "redis", "rabbitmq", "kafka", "nats",
      "influxdb", "grpc", "protobuf", "websocket", "websockets", "docker",
      "docker compose", "github actions", "gitlab ci", "aws", "nginx", "supabase",
      "cloudflare workers", "n8n", "prometheus", "grafana", "loki", "sentry",
      "opentelemetry", "otel", "oauth2", "oauth", "jwt", "webauthn", "fido2",
      "supertokens", "llm", "openai", "gpt", "rag", "retrieval-augmented",
      "prompt engineering", "genai", "dicom", "pacs", "medical imaging",
      "teleradiology", "hipaa", "phi", "ohif", "microservices", "clean architecture",
      "ddd", "domain-driven", "cqrs", "event-driven", "idempotency", "idempotent",
      "circuit breaker", "rate limit", "token bucket", "pytest", "testcontainers",
      "payment gateway",
    ],
    supporting: [
      "typescript", "javascript", "react", "next.js", "nextjs", "vue", "vue 3",
      "jinja", "html", "css", "mui", "material ui", "plotly", "pandas", "lxml",
      "python-docx", "openpyxl", "ga4", "google analytics", "posthog",
      "telegram bot", "i18n",
    ],
    // Table words: present in every posting ever written, so they say nothing
    // about this one. They belong in neither the numerator nor the denominator.
    neutral: [
      "rest", "restful", "api", "apis", "crud", "http", "https", "json", "yaml",
      "xml", "git", "github", "gitlab", "ci/cd", "cicd", "agile", "scrum", "kanban",
      "jira", "linux", "unix", "bash", "oop", "solid", "tdd", "unit test",
      "code review", "sql", "cloud", "monitoring", "logging", "testing", "debugging",
      "refactoring", "scalable", "performance", "security", "best practices",
      "ownership", "saas", "b2b", "b2c", "startup",
    ],
    // On the résumé, but not what the person wants to do next. Counting these
    // as a match inflates mobile roles to 83%; counting them as a gap lies
    // about the résumé. Instead each hit is evidence of the discipline.
    owned: [
      "react native", "expo", "expo router", "eas build", "flutter", "dart",
      "metro bundler", "react navigation",
    ],
    adjacent: [
      "kubernetes", "k8s", "helm", "argocd", "terraform", "pulumi", "ansible",
      "jenkins", "circleci", "azure", "gcp", "google cloud", "cloud run", "gke",
      "lambda", "serverless", "ecs", "eks", "istio", "vault", "datadog", "new relic",
      "splunk", "elasticsearch", "opensearch", "kibana", "jaeger", "mysql", "mariadb",
      "sqlite", "cassandra", "dynamodb", "clickhouse", "neo4j", "memcached",
      "timescaledb", "numpy", "pgvector", "pinecone", "weaviate", "qdrant", "chroma",
      "langchain", "langgraph", "llamaindex", "graphql", "apollo", "trpc", "nuxt",
      "svelte", "sveltekit", "remix", "astro", "tailwind", "redux", "zustand",
      "storybook", "vite", "webpack", "cypress", "playwright", "selenium",
      "puppeteer", "jest", "vitest", "k6", "locust", "stripe", "paypal", "twilio",
      "auth0", "okta", "keycloak", "firebase", "vercel", "drizzle", "prisma",
      "bullmq", "turborepo",
    ],
    alien: [
      "java", "spring", "spring boot", "hibernate", "maven", "gradle", "jpa",
      "kotlin", "scala", "quarkus", "micronaut", "groovy",
      "c#", ".net", "dotnet", "asp.net", "entity framework", "blazor", "xamarin",
      "php", "laravel", "symfony", "wordpress", "drupal", "magento",
      "ruby", "rails", "ruby on rails", "sinatra",
      "go", "golang",
      "rust", "actix", "tokio", "c++", "qt", "objective-c", "swift", "swiftui",
      "perl", "cobol", "delphi", "fortran", "zig",
      "node.js", "nodejs", "express", "nest.js", "nestjs", "koa", "deno", "bun",
      "fastify", "angular", "angularjs", "ember", "backbone",
      "jetpack compose", "ionic", "cordova", "capacitor", "xcode", "android studio",
      "sap", "abap", "salesforce", "apex", "servicenow", "sharepoint", "powerapps",
      "dynamics",
      "pytorch", "tensorflow", "keras", "scikit-learn", "sklearn", "xgboost",
      "lightgbm", "hugging face", "transformers", "cuda", "mlflow", "kubeflow",
      "sagemaker", "vertex ai", "fine-tuning", "model training", "deep learning",
      "neural network", "computer vision", "opencv", "nlp", "spacy", "nltk",
      "spark", "pyspark", "hadoop", "hive", "flink", "airflow", "dagster", "prefect",
      "dbt", "snowflake", "redshift", "bigquery", "databricks", "tableau", "power bi",
      "looker", "data warehouse", "data lake", "star schema", "etl", "debezium",
      "matlab", "sas", "spss", "julia", "elixir", "phoenix", "erlang", "haskell",
      "clojure", "unity", "unreal", "godot",
      "verilog", "vhdl", "rtos", "freertos", "arduino", "esp32", "stm32", "plc",
      "scada", "can bus", "modbus", "firmware", "embedded c",
    ],
  },
  targetDisciplines: ["backend", "fullstack", "ai"],
  haveYears: 6,
  yearsStretch: 4,
  knownLanguages: ["English", "Russian"],
  wantRoles: [
    "python", "django", "fastapi", "backend", "back-end", "full[- ]?stack",
    "software engineer", "software developer", "platform engineer",
    "engineering manager", "tech(?:nical)? lead", "team lead", "staff engineer",
    "principal engineer", "founding engineer", "head of engineering",
    "business analyst", "systems? analyst",
    // Cyrillic titles need their own entries: the word boundary used for the
    // list is Unicode-aware, but the words themselves are not translations.
    "бизнес[- ]?аналитик", "системн\\p{L}*\\s+аналитик", "разработчик",
    "программист", "тимлид", "руководитель разработки",
  ],
  // Applied AI is a backend job: the glue around somebody else's model is
  // written in Python. Checked before the skip lists, which contain "ml" —
  // without that order "AI/ML Engineer" was dropped whole, applied half included.
  wantRolesPriority: [
    "(?:ai|llm|genai|gen[- ]ai|generative ai|applied ai|agentic|rag)\\s*(?:[\\/&+]\\s*ml\\s*)?(?:engineer|developer|architect|specialist)",
    "forward[- ]deployed engineer",
    "ai (?:platform|backend|integration|infrastructure|product) engineer",
    "prompt engineer",
  ],
  skipRoles: {
    role: [
      "qa", "sdet", "test engineer", "data scientist", "machine learning", "ml",
      "devops", "sre", "site reliability", "security engineer",
      "(?:data|financial|marketing|credit|risk|product|business intelligence|bi)\\s+analyst",
      "data analyst", "designer", "sales", "marketing", "seo", "recruiter",
      "support", "intern", "android", "ios", "mobile", "unreal", "game", "tutor",
      "instructor", "teacher", "curriculum", "freelance writer", "guest relations",
      "concierge", "housekeeping", "front office", "airfreight", "freight",
      "customs", "import team", "hospitality",
      "аналитик\\s*1с", "финансов\\p{L}*\\s+аналитик", "продуктов\\p{L}*\\s+аналитик",
      "data.аналитик", "дизайнер", "тестировщик", "рекрутер", "маркетолог",
      "frontend", "front-end", "фронтенд", "фронт[- ]?энд", "верстальщик",
    ],
    // A foreign language named in the title means 0 years on the questionnaire:
    // applying would be a lie about oneself.
    stack: [
      "asp\\.net", "\\.net", "c#", "c\\+\\+", "java", "php", "ruby", "rails",
      "salesforce", "sap", "kotlin", "scala", "swift", "rust", "elixir",
      // "Ведущий Go-разработчик" passed as a target role: the Russian word for
      // developer is in the want list and no rule named the language. A title
      // is the one place where a bare language name means the language.
      "go", "golang",
    ],
    // A platform instead of a language. "Drupal/CMS Technical Lead" passed as a
    // target role: the title says Technical Lead and the stack list knew Java
    // and PHP but neither Drupal nor Shopify.
    platform: [
      "drupal", "wordpress", "woocommerce", "joomla", "magento", "shopify",
      "bigcommerce", "prestashop", "sitecore", "umbraco", "typo3", "liferay",
      "adobe experience manager", "aem", "craft cms", "webflow", "squarespace",
      "wix", "odoo", "sharepoint", "servicenow", "cms",
    ],
    // An engineer, but not a programmer. "15+ years in aeronautics engineering"
    // passed every filter: the word engineering is there and no foreign stack is.
    nonSoftware: [
      "(?:aeronautic|aerospace|aviation|mechanic|civil|structural|electric|electronic|chemical|petroleum|mining|nuclear|marine|automotive|manufacturing|hvac|geotechnical|hydraulic)(?:s|al|s?al)?\\s+(?:engineer|engineering)",
    ],
    research: [
      "research (?:scientist|engineer)", "deep learning", "computer vision",
      "nlp (?:researcher|scientist)", "ml researcher", "data scientist", "mlops",
      "phd",
    ],
  },
  foreignStacks: [
    { name: "C#", pattern: "(?<![a-z0-9])c#" },
    { name: ".NET", pattern: "(?<![a-z0-9])\\.net\\b" },
    { name: "Java", pattern: "\\bjava\\b" },
    { name: "PHP", pattern: "\\bphp\\b" },
    { name: "Ruby", pattern: "\\bruby\\b|\\brails\\b" },
    { name: "Kotlin", pattern: "\\bkotlin\\b" },
    { name: "Scala", pattern: "\\bscala\\b" },
    { name: "Swift", pattern: "\\bswift\\b" },
    { name: "C++", pattern: "(?<![a-z0-9])c\\+\\+" },
    { name: "Elixir", pattern: "\\belixir\\b" },
    { name: "Perl", pattern: "\\bperl\\b" },
    { name: "Rust", pattern: "\\brust\\b" },
    // Bare "go" matches "we go fast". It counts only where it is a language.
    {
      name: "Go",
      pattern:
        "\\bgolang\\b|(?<![a-z0-9])go(?=\\s*(?:developer|engineer|programmer|routines?|services?|microservices?|backend))",
    },
    { name: "Drupal", pattern: "\\bdrupal\\b" },
    { name: "WordPress", pattern: "\\bwordpress\\b|\\bwoocommerce\\b" },
    { name: "Shopify", pattern: "\\bshopify\\b" },
    { name: "Magento", pattern: "\\bmagento\\b" },
    { name: "Sitecore", pattern: "\\bsitecore\\b|\\btypo3\\b|\\bumbraco\\b|\\bliferay\\b" },
  ],
};

/** Settings hold a partial profile; missing keys fall back to the default. */
export function mergeProfile(partial?: Partial<FitProfile> | null): FitProfile {
  if (!partial) return DEFAULT_PROFILE;
  return {
    ...DEFAULT_PROFILE,
    ...partial,
    tiers: { ...DEFAULT_PROFILE.tiers, ...partial.tiers },
    skipRoles: { ...DEFAULT_PROFILE.skipRoles, ...partial.skipRoles },
  };
}

/** Tags and links are not the text of a posting: `ixlib=rails-4` is not Rails. */
export function cleanText(text: unknown): string {
  return String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One regex out of a list of fragments, with Unicode-aware boundaries.
 * `\b` treats only Latin as word characters, so "Системный аналитик" matched
 * nothing at all while the word sat right there in the list.
 */
export function listRe(fragments: string[]): RegExp {
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${fragments.join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );
}
