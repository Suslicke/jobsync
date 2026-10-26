import type { OIDCConfig } from "next-auth/providers";
import type { JWT } from "next-auth/jwt";
import type { Account, Profile } from "next-auth";
import prisma from "@/lib/db";

// Optional "Sign in with Pocket ID" login, next to the password login.
//
// It is off unless all three env vars are set. It never creates users: a
// Pocket ID login is mapped onto the existing JobSync user whose email equals
// the verified email Pocket ID reports. Which Pocket ID users may log in at all
// is decided in Pocket ID (the client is restricted to a user group).

export const POCKET_ID_PROVIDER_ID = "pocket-id";

// Error code the sign-in page shows when no JobSync user matches.
export const POCKET_ID_NO_ACCOUNT_ERROR = "PocketIdNoAccount";

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

function verifiedEmail(profile: Profile | undefined): string | null {
  if (!profile || profile.email_verified !== true) return null;
  const email = typeof profile.email === "string" ? profile.email.trim() : "";
  return email || null;
}

// The existing JobSync user for this Pocket ID profile, or null. Read-only.
export async function findUserForPocketId(profile: Profile | undefined) {
  const email = verifiedEmail(profile);
  if (!email) return null;
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });
}

// signIn callback branch: let the login through only for a matching user.
export async function pocketIdSignIn(params: {
  account?: Account | null;
  profile?: Profile;
}): Promise<boolean | string> {
  if (params.account?.provider !== POCKET_ID_PROVIDER_ID) return true;
  const user = await findUserForPocketId(params.profile);
  if (!user) return `/signin?error=${POCKET_ID_NO_ACCOUNT_ERROR}`;
  return true;
}

// jwt callback branch on the initial Pocket ID login: the token must carry the
// JobSync user id, not Pocket ID's subject.
export async function pocketIdJwt(token: JWT, profile: Profile | undefined) {
  const user = await findUserForPocketId(profile);
  if (!user) throw new Error("No JobSync user for this Pocket ID login");
  return {
    ...token,
    id: user.id,
    sub: user.id,
    name: user.name,
    email: user.email,
  };
}
