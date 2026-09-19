import { APP_CONSTANTS } from "@/lib/constants";
import { decodeHtml } from "../html";
import type { JobDetails } from "../types";

// One message out of a channel's web preview.
export interface TelegramPost {
  id: number;
  // The message body as LinkedIn-style raw HTML, kept raw because the apply
  // link is an <a href> and the text parsers want the same message decoded.
  html: string;
  postedAt: string;
}

// What a post layout yields before it becomes a JobDetails. Three different
// layouts produce it, which is the only reason any of this is structured.
interface ParsedCard {
  title: string;
  company: string;
  location: string;
  salary?: string;
}

// flattenHtml is not usable here: all three post layouts are recognised by line
// structure — "Компания:" alone on a line, a hashtag row as line one, the
// headline as line one — and flattenHtml collapses every newline into a space,
// erasing exactly the signal the parsers read.
export function decodePost(html: string): string {
  const text = decodeHtml(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

// Splits a preview page into messages. Split first, match second: the date and
// the body live in different parts of one message block, and a single regex
// spanning from one to the other reaches across the message boundary as soon as
// a message has no body (a photo-only post), stapling one post's text to the
// next post's timestamp.
export function parseChannelPage(html: string): TelegramPost[] {
  const posts: TelegramPost[] = [];
  const chunks = String(html).split(/data-post="[^"/]+\/(\d+)"/);
  // split() with one capture group yields [before, id, chunk, id, chunk, ...].
  for (let i = 1; i < chunks.length; i += 2) {
    const id = Number(chunks[i]);
    const chunk = chunks[i + 1] ?? "";
    const body = chunk.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    )?.[1];
    if (!id || !body) continue;
    posts.push({
      id,
      html: body,
      // The preview stamps every message with an ISO datetime. The old
      // collector dropped it and every Telegram row arrived undated, which the
      // freshness checks have to read as unmeasured rather than as new.
      postedAt: chunk.match(/<time datetime="([^"]+)"/)?.[1] ?? "",
    });
  }
  return posts;
}

const line = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

// A company name starts with a capital or a quote. This one test is what
// separates a vacancy card from a digest: "Дайджест вакансий в зарубежных
// стартапах" fits the headline layout perfectly and offers "зарубежных
// стартапах" as the employer.
const COMPANY_START = /^[A-ZА-ЯЁ0-9«"(]/;

// Layout 1: labelled fields. "Компания: X" / "Вакансия: Y" / "Локация: Z", the
// way itvacancykz writes; the headline parser lifted one post in twenty here.
export function parseLabelledPost(text: string): ParsedCard | null {
  const lines = line(text).slice(0, 16);
  const pick = (re: RegExp): string => {
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m[1].trim();
    }
    return "";
  };

  // The company label is required. Without it this is a note about hiring, not
  // a card for one job.
  let company = pick(
    /^(?:компани[яи]|company|работодатель|employer)\s*[:：]\s*(.+)$/i,
  );
  if (!company) return null;
  // "Higgsfield AI · Алматы" — the city is glued to the name with a separator.
  company = company.split(/\s+[·|]\s+/)[0].trim();

  let title = pick(
    /^(?:вакансия|позиция|должность|роль|role|position|job title)\s*[:：]\s*(.+)$/i,
  );
  if (!title) {
    // No label for the role: take the first line that is neither a label nor a
    // work-format note.
    for (const l of lines.slice(0, 6)) {
      if (/[:：]/.test(l)) continue;
      // A hashtag row is not a job title. "#vacancy #AI #Python #Uzbekistan"
      // went through as one on the first live channel this was pointed at.
      if (/^#/.test(l) || (l.match(/#/g) || []).length >= 2) continue;
      if (
        /^(remote|удал|гибрид|hybrid|офис|office|onsite|b2b|b2c|fulltime|full[- ]time)\b/i.test(
          l,
        )
      ) {
        continue;
      }
      if (l.length > 3 && l.length < 120) {
        title = l;
        break;
      }
    }
  }
  if (!title) return null;

  const location =
    pick(/^(?:локация|location|город|city|офис)\s*[:：]\s*(.+)$/i) ||
    text.match(/📍\s*([^\n]{2,80})/)?.[1] ||
    "";
  const salary = pick(
    /^(?:зарплата|salary|оклад|вилка|компенсация)\s*[:：]\s*(.+)$/i,
  );

  return {
    title: title.replace(/,\s*[^,]{2,20}$/, "").trim(),
    company,
    location,
    salary,
  };
}

// Layout 2: a hashtag row, then the company on its own line, then the role.
//
//   #senior #удаленка #москва
//   Лига Цифровой Экономики
//   Ведущий Python-разработчик
//
// job_python and devs_it write this way, and the other two parsers lifted one
// post in twenty and zero in eighteen from them.
export function parseHashtagPost(text: string): ParsedCard | null {
  const lines = line(text);
  if (!lines.length) return null;
  // The opening hashtag row is this layout's signature. Without checking for it
  // the parser would make a "company" and a "role" out of the first two lines
  // of any post at all.
  if (!/^#\S/.test(lines[0])) return null;

  const rest = lines.slice(1).filter((l) => !/^#\S/.test(l));
  const [company, title] = rest;
  if (!company || !title) return null;
  if (company.length > 60 || title.length > 140) return null;
  if (/[:：]/.test(company)) return null; // that is a label, not a name
  if (!COMPANY_START.test(company)) return null;

  const format =
    rest.find((l) => /^формат работы|^формат|^локация|^город/i.test(l)) ?? "";
  const location =
    format.replace(/^[^:：]*[:：]\s*/, "").trim() ||
    (/#удал[её]нк|#remote/i.test(lines[0]) ? "Remote" : "") ||
    lines[0].match(/#(москва|спб|санкт|минск|алматы|астана|казань|нн)\b/i)?.[1] ||
    "";

  return { title, company, location };
}

// Layout 3: the headline says it all — "<role> в <company>", or "at" in the
// English channels. Without the joining word this is an announcement or a
// digest, not a card, and guessing is worse than skipping.
export function parseHeadlinePost(
  headline: string,
  text: string,
): ParsedCard | null {
  const m = headline.match(/^(.+?)\s+(?:в|at)\s+([^,|]{2,60})$/i);
  if (!m) return null;
  if (/^(дайджест|подборк|топ[-\s]?\d|вакансии|итоги)/i.test(m[1])) return null;
  if (!COMPANY_START.test(m[2].trim())) return null;
  return {
    title: m[1].trim(),
    company: m[2].trim(),
    location: text.match(/📍\s*([^\n]{2,80})/)?.[1] ?? "",
  };
}

const REMOTE = /remote|удал[её]нн|worldwide|из любой точки/i;

// One post to one job, or null when the post is not a job card. Layout is
// decided per post rather than per channel: every channel carries all three,
// because the posts are forwarded and pasted from wherever they came from.
export function parsePost(
  post: TelegramPost,
  channel: string,
): JobDetails | null {
  const text = decodePost(post.html);
  const lines = line(text);
  const first = lines[0] ?? "";
  // A first line long enough to be a paragraph is a write-up about a company,
  // not a headline.
  if (!first || first.length > 160) return null;

  // A hashtag row is a prefix, not a layout: what follows it is sometimes
  // "<company>\n<role>" and sometimes an ordinary headline. itvacancykz writes
  // "#computervision #python ... / CV Engineer (remote) в I2NIK / 1 200 000 -
  // 1 500 000 тг", and reading that as company-then-role hired
  // "1 200 000 - 1 500 000 тг" at a company called "CV Engineer (remote) в
  // I2NIK". So the headline is tried against the first line that is not a
  // hashtag row, whichever layout the post turns out to be.
  const headline = lines.find((l) => !/^#\S/.test(l)) ?? "";

  // Every layout is tried, and none of them may be a gate. The headline parser
  // used to be one — it accepts any line containing " в " — so the labelled
  // post whose first line was "Город: Алматы / гибрид (офис + выезды в
  // поликлиники)" matched it, failed the capital-letter test on "поликлиники)"
  // and was dropped, while three lines below it said "Компания: qBots" and
  // "Вакансия: Junior Project Manager".
  const card =
    parseHeadlinePost(headline, text) ??
    parseHashtagPost(text) ??
    parseLabelledPost(text);
  if (!card) return null;

  return {
    title: card.title,
    company: card.company,
    location: card.location,
    // The post IS the description. There is nothing else to fetch: a channel
    // post is the whole advertisement.
    description: text,
    // The post's own permalink, never a link taken out of the post body. Those
    // links are not reliably the application: the first one is usually an
    // article about the company (four Tangem posts sent the applicant to a
    // Finextra press release that way), and a channel's footer link to its own
    // VK page matches any "looks like a job board" rule — on job_python it
    // matched on every post, which would have given twenty different jobs one
    // identical URL and collapsed them into a single row.
    url: `https://t.me/${channel}/${post.id}`,
    postedDate: post.postedAt || undefined,
    salary: card.salary || undefined,
    isRemote: REMOTE.test(`${card.location} ${first}`),
  };
}

export function channelPageUrl(channel: string, before: number): string {
  const base = `${APP_CONSTANTS.TELEGRAM_BASE_URL}/${encodeURIComponent(channel)}`;
  return before > 0 ? `${base}?before=${before}` : base;
}
