import {
  POCKET_ID_NO_ACCOUNT_ERROR,
  POCKET_ID_PROVIDER_ID,
  findUserForPocketId,
  getPocketIdConfig,
  isPocketIdEnabled,
  pocketIdJwt,
  pocketIdProvider,
  pocketIdSignIn,
} from "@/lib/auth/pocketId";
import prisma from "@/lib/db";
import NextAuth from "next-auth";

vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

const fullEnv = {
  POCKET_ID_ISSUER: "https://id.example.com/",
  POCKET_ID_CLIENT_ID: "client-id",
  POCKET_ID_CLIENT_SECRET: "client-secret",
};

const existingUser = { id: "user-1", name: "Owner", email: "owner@example.com" };
const pocketAccount = {
  provider: POCKET_ID_PROVIDER_ID,
  type: "oidc" as const,
  providerAccountId: "pocket-sub",
};

describe("Pocket ID config", () => {
  it("is disabled when no env vars are set", () => {
    expect(getPocketIdConfig({})).toBeNull();
    expect(isPocketIdEnabled({})).toBe(false);
  });

  it.each(Object.keys(fullEnv))("is disabled when %s is missing", (key) => {
    const env: Record<string, string | undefined> = { ...fullEnv };
    delete env[key];
    expect(isPocketIdEnabled(env)).toBe(false);
  });

  it("builds an OIDC provider with PKCE, state and the openid scopes", () => {
    const config = getPocketIdConfig(fullEnv);
    expect(config).toEqual({
      issuer: "https://id.example.com",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    const provider = pocketIdProvider(config!);
    expect(provider).toMatchObject({
      id: "pocket-id",
      type: "oidc",
      issuer: "https://id.example.com",
      checks: ["pkce", "state"],
      authorization: { params: { scope: "openid profile email" } },
    });
  });
});

describe("Pocket ID account mapping", () => {
  it("maps a verified email to the existing user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser as never);

    const user = await findUserForPocketId({
      email: "owner@example.com",
      email_verified: true,
    });

    expect(user).toEqual(existingUser);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "owner@example.com" } }),
    );
    await expect(
      pocketIdSignIn({
        account: pocketAccount,
        profile: { email: "owner@example.com", email_verified: true },
      }),
    ).resolves.toBe(true);
  });

  it("puts the JobSync user id, not the Pocket ID subject, in the token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser as never);

    const token = await pocketIdJwt(
      { sub: "pocket-sub", email: "owner@example.com" },
      { sub: "pocket-sub", email: "owner@example.com", email_verified: true },
    );

    expect(token).toMatchObject({ id: "user-1", sub: "user-1", email: "owner@example.com" });
  });

  it("refuses an unknown email and creates no user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const result = await pocketIdSignIn({
      account: pocketAccount,
      profile: { email: "stranger@example.com", email_verified: true },
    });

    expect(result).toBe(`/signin?error=${POCKET_ID_NO_ACCOUNT_ERROR}`);
    await expect(
      pocketIdJwt({}, { email: "stranger@example.com", email_verified: true }),
    ).rejects.toThrow();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("refuses an unverified email without looking it up", async () => {
    const result = await pocketIdSignIn({
      account: pocketAccount,
      profile: { email: "owner@example.com", email_verified: false },
    });

    expect(result).toBe(`/signin?error=${POCKET_ID_NO_ACCOUNT_ERROR}`);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("leaves credential logins alone", async () => {
    await expect(
      pocketIdSignIn({
        account: { provider: "credentials", type: "credentials", providerAccountId: "x" },
      }),
    ).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("NextAuth provider list", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  async function providerIds(): Promise<string[]> {
    vi.resetModules();
    vi.mocked(NextAuth).mockClear();
    await import("@/auth");
    const { default: NextAuthFresh } = await import("next-auth");
    const config = vi.mocked(NextAuthFresh).mock.calls.at(-1)?.[0] as unknown as {
      providers: { id: string }[];
    };
    return config.providers.map((p) => p.id);
  }

  it("has only the credentials provider when Pocket ID env is unset", async () => {
    delete process.env.POCKET_ID_ISSUER;
    delete process.env.POCKET_ID_CLIENT_ID;
    delete process.env.POCKET_ID_CLIENT_SECRET;

    expect(await providerIds()).toEqual(["credentials"]);
  });

  it("adds the pocket-id provider when Pocket ID env is set", async () => {
    Object.assign(process.env, fullEnv);

    expect(await providerIds()).toEqual(["credentials", "pocket-id"]);
  });
});
