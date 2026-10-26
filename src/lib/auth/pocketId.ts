import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { OIDCConfig } from "next-auth/providers";
import { decode, type JWT } from "next-auth/jwt";
import type { Account, Profile } from "next-auth";
import prisma from "@/lib/db";

// Optional "Sign in with Pocket ID" login, next to the password login.
//
// It is off unless all three env vars are set. A Pocket ID login is bound to a
// JobSync user by Pocket ID's subject ("sub"), never by email: emails can be
// changed in Pocket ID, the subject cannot. The binding is created only from a
// session that is already signed in (Settings -> Sign-in -> Connect Pocket ID).
// Sign-in with an unbound subject is refused; no user is ever created.
// Which Pocket ID users may get a token at all is decided in Pocket ID (the
// client is restricted to a user group).

export const POCKET_ID_PROVIDER_ID = "pocket-id";

// Error codes shown on /signin and in Settings.
export const POCKET_ID_NOT_LINKED_ERROR = "PocketIdNotLinked";
export const POCKET_ID_ALREADY_LINKED_ERROR = "PocketIdAlreadyLinked";
export const POCKET_ID_USER_ALREADY_LINKED_ERROR = "PocketIdUserAlreadyLinked";

// Cookie that marks the next Pocket ID callback as "connect to this user".
export const POCKET_ID_LINK_COOKIE = "jobsync.pocket-id-link";
export const POCKET_ID_LINK_TTL_SECONDS = 600;

export const POCKET_ID_SETTINGS_PATH = "/dashboard/settings";

export interface PocketIdConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

type Env = Record<string, string | undefined>;

export function getPocketIdConfig(
  env: Env = process.env,
): PocketIdConfig | null {
  const issuer = env.POCKET_ID_ISSUER?.trim();
  const clientId = env.POCKET_ID_CLIENT_ID?.trim();
  const clientSecret = env.POCKET_ID_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) return null;
  return { issuer: issuer.replace(/\/+$/, ""), clientId, clientSecret };
}

export function isPocketIdEnabled(env: Env = process.env): boolean {
  return getPocketIdConfig(env) !== null;
}

export function pocketIdProvider(config: PocketIdConfig): OIDCConfig<Profile> {
  return {
    id: POCKET_ID_PROVIDER_ID,
    name: "Pocket ID",
    type: "oidc",
    // Endpoints come from <issuer>/.well-known/openid-configuration.
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    checks: ["pkce", "state"],
    authorization: { params: { scope: "openid profile email" } },
  };
}

// ---- link intent: "<userId>.<expiresAtSeconds>.<hmac>" signed with AUTH_SECRET

function linkSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", linkSecret())
    .update(`pocket-id-link:${payload}`)
    .digest("base64url");
}

export function createLinkIntent(userId: string, nowMs = Date.now()): string {
  const expires = Math.floor(nowMs / 1000) + POCKET_ID_LINK_TTL_SECONDS;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

// The user id the intent was minted for, or null if forged, malformed or expired.
export function verifyLinkIntent(
  value: string | undefined | null,
  nowMs = Date.now(),
): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, mac] = parts;
  if (!userId || !/^\d+$/.test(expires)) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  if (Number(expires) * 1000 < nowMs) return null;
  return userId;
}

// Set by the "Connect Pocket ID" server action for the signed-in user.
export async function setLinkIntentCookie(userId: string) {
  const store = await cookies();
  store.set(POCKET_ID_LINK_COOKIE, createLinkIntent(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: POCKET_ID_LINK_TTL_SECONDS,
  });
}

// Called when a plain "Sign in with Pocket ID" starts and on sign-out, so a
// stale intent can never apply to a later login.
export async function clearLinkIntentCookie() {
  try {
    const store = await cookies();
    if (store.get(POCKET_ID_LINK_COOKIE)) store.delete(POCKET_ID_LINK_COOKIE);
  } catch {
    // Read-only cookie store; the intent still expires on its own.
  }
}

async function consumeLinkIntentCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(POCKET_ID_LINK_COOKIE)?.value;
  if (value) {
    try {
      store.delete(POCKET_ID_LINK_COOKIE);
    } catch {
      // Read-only cookie store; the intent still expires on its own.
    }
  }
  return verifyLinkIntent(value);
}

// User id of the Auth.js session cookie on this request, or null. Decoded
// directly (salt = cookie name) because this runs inside Auth.js's own callback.
const SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

export async function currentSessionUserId(): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const store = await cookies();
  const all = store.getAll();
  for (const name of SESSION_COOKIE_NAMES) {
    // Large sessions are split into "<name>.0", "<name>.1", ...
    const whole = all.find((c) => c.name === name)?.value;
    const chunks = all
      .filter((c) => c.name.startsWith(`${name}.`))
      .sort(
        (a, b) =>
          Number(a.name.slice(name.length + 1)) -
          Number(b.name.slice(name.length + 1)),
      )
      .map((c) => c.value)
      .join("");
    const token = whole || chunks;
    if (!token) continue;
    try {
      const payload = await decode({ token, secret, salt: name });
      const id = (payload?.id as string | undefined) || payload?.sub;
      if (id) return id;
    } catch {
      // Invalid or expired cookie: no session.
    }
  }
  return null;
}

// ---- bindings

export async function findUserBySubject(subject: string | undefined | null) {
  if (!subject) return null;
  const identity = await prisma.oidcIdentity.findUnique({
    where: {
      provider_subject: { provider: POCKET_ID_PROVIDER_ID, subject },
    },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  return identity?.user ?? null;
}

// Bind `subject` to `userId`. Never replaces a binding: refuses a subject bound
// to someone else, and a user who already has a different Pocket ID bound.
export async function linkSubjectToUser(
  userId: string,
  subject: string,
): Promise<
  "linked" | "already-linked-elsewhere" | "user-already-linked" | "no-user"
> {
  const existing = await prisma.oidcIdentity.findUnique({
    where: {
      provider_subject: { provider: POCKET_ID_PROVIDER_ID, subject },
    },
    select: { userId: true },
  });
  if (existing) {
    return existing.userId === userId ? "linked" : "already-linked-elsewhere";
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return "no-user";
  if (await getPocketIdLinkForUser(userId)) return "user-already-linked";
  await prisma.oidcIdentity.create({
    data: { userId, provider: POCKET_ID_PROVIDER_ID, subject },
  });
  return "linked";
}

export async function unlinkPocketIdForUser(userId: string) {
  await prisma.oidcIdentity.deleteMany({
    where: { userId, provider: POCKET_ID_PROVIDER_ID },
  });
}

export async function getPocketIdLinkForUser(userId: string) {
  return prisma.oidcIdentity.findUnique({
    where: { userId_provider: { userId, provider: POCKET_ID_PROVIDER_ID } },
    select: { createdAt: true },
  });
}

// ---- NextAuth callbacks

function subjectOf(account: Account | null | undefined): string | null {
  const sub = account?.providerAccountId;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

// signIn callback. A link intent is honoured only while the request still
// carries a session of the same user; otherwise it is dropped and this is a
// plain sign-in by subject. `deps` lets tests skip the cookie reads.
export async function pocketIdSignIn(
  params: { account?: Account | null; profile?: Profile },
  deps: {
    linkIntentUserId?: string | null;
    sessionUserId?: string | null;
  } = {},
): Promise<boolean | string> {
  if (params.account?.provider !== POCKET_ID_PROVIDER_ID) return true;
  const subject = subjectOf(params.account);
  const intentUserId =
    deps.linkIntentUserId === undefined
      ? await consumeLinkIntentCookie()
      : deps.linkIntentUserId;
  const sessionUserId = intentUserId
    ? deps.sessionUserId === undefined
      ? await currentSessionUserId()
      : deps.sessionUserId
    : null;

  if (intentUserId && sessionUserId === intentUserId) {
    const settings = `${POCKET_ID_SETTINGS_PATH}?pocketIdError=`;
    if (!subject) return settings + POCKET_ID_NOT_LINKED_ERROR;
    const result = await linkSubjectToUser(intentUserId, subject);
    if (result === "linked") return true;
    if (result === "user-already-linked") {
      return settings + POCKET_ID_USER_ALREADY_LINKED_ERROR;
    }
    return settings + POCKET_ID_ALREADY_LINKED_ERROR;
  }

  const user = await findUserBySubject(subject);
  if (!user) return `/signin?error=${POCKET_ID_NOT_LINKED_ERROR}`;
  return true;
}

// jwt callback branch on a Pocket ID login: the token must carry the JobSync
// user bound to this subject, not Pocket ID's subject.
export async function pocketIdJwt(token: JWT, account: Account) {
  const user = await findUserBySubject(subjectOf(account));
  if (!user) throw new Error("Pocket ID subject is not linked to a JobSync user");
  return {
    ...token,
    id: user.id,
    sub: user.id,
    name: user.name,
    email: user.email,
  };
}
