import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { User } from "./models/user.model";
import prisma from "./lib/db";
import { getActingUser } from "./lib/mcp/actingUser";
import {
  POCKET_ID_PROVIDER_ID,
  getPocketIdConfig,
  pocketIdJwt,
  pocketIdProvider,
  pocketIdSignIn,
} from "./lib/auth/pocketId";

async function getUser(email: string): Promise<User | undefined> {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });
    return user || undefined;
  } catch (error) {
    console.error("Failed to fetch user:", error);
    throw new Error("Failed to fetch user.");
  }
}

// Optional SSO login; absent unless POCKET_ID_* env vars are all set.
const pocketIdConfig = getPocketIdConfig();

const nextAuth = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    signIn: (params) => pocketIdSignIn(params),
    async jwt(params) {
      if (params.account?.provider === POCKET_ID_PROVIDER_ID) {
        return pocketIdJwt(params.token, params.account);
      }
      return authConfig.callbacks.jwt(params);
    },
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);
          if (!user) return null;
          const passwordsMatch = await bcrypt.compare(password, user.password);
          if (passwordsMatch) return user;
        }
        console.log("Invalid credentials");
        return null;
      },
    }),
    ...(pocketIdConfig ? [pocketIdProvider(pocketIdConfig)] : []),
  ],
});

export const { handlers, signIn, signOut } = nextAuth;

// Inside an MCP request with a full-access token (see lib/mcp/actingUser) the
// no-argument form of auth() returns the token owner's session, so server
// actions and route handlers run unchanged with their usual ownership checks.
// Every other call — browser requests, middleware wrappers — goes to NextAuth.
export const auth = ((...args: unknown[]) => {
  const acting = args.length === 0 ? getActingUser() : undefined;
  if (acting) {
    return Promise.resolve({
      user: { id: acting.id, name: acting.name, email: acting.email },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
  }
  return (nextAuth.auth as (...a: unknown[]) => unknown)(...args);
}) as typeof nextAuth.auth;
