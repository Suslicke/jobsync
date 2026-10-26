import {
  POCKET_ID_ALREADY_LINKED_ERROR,
  POCKET_ID_LINK_COOKIE,
  POCKET_ID_NOT_LINKED_ERROR,
  POCKET_ID_PROVIDER_ID,
  createLinkIntent,
  getPocketIdConfig,
  isPocketIdEnabled,
  pocketIdJwt,
  pocketIdProvider,
  pocketIdSignIn,
  verifyLinkIntent,
} from "@/lib/auth/pocketId";
import prisma from "@/lib/db";

const cookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

// In-memory OidcIdentity / User tables.
const db = vi.hoisted(() => ({
  users: [] as { id: string; name: string; email: string }[],
  identities: [] as { userId: string; provider: string; subject: string }[],
}));

vi.mock("@/lib/db", () => {
  const userById = (id: string) => db.users.find((u) => u.id === id) ?? null;
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        where.id ? userById(where.id) : db.users.find((u) => u.email === where.email) ?? null,
      ),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    oidcIdentity: {
      findUnique: vi.fn(async ({ where }: { where: { provider_subject: { provider: string; subject: string } } }) => {
        const { provider, subject } = where.provider_subject;
        const row = db.identities.find((i) => i.provider === provider && i.subject === subject);
        return row ? { userId: row.userId, user: userById(row.userId) } : null;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string; provider: string } }) => {
        db.identities = db.identities.filter(
          (i) => !(i.userId === where.userId && i.provider === where.provider),
        );
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; provider: string; subject: string } }) => {
        db.identities.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { default: prisma };
});

const fullEnv = {
  POCKET_ID_ISSUER: "https://id.example.com/",
  POCKET_ID_CLIENT_ID: "client-id",
  POCKET_ID_CLIENT_SECRET: "client-secret",
};

const owner = { id: "user-1", name: "Owner", email: "owner@example.com" };
const other = { id: "user-2", name: "Other", email: "other@example.com" };

const account = (sub: string) => ({
  provider: POCKET_ID_PROVIDER_ID,
  type: "oidc" as const,
  providerAccountId: sub,
});

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  db.users = [owner, other];
  db.identities = [];
  cookieStore.get.mockReturnValue(undefined);
});

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
    const provider = pocketIdProvider(getPocketIdConfig(fullEnv)!);
    expect(provider).toMatchObject({
      id: "pocket-id",
      type: "oidc",
      issuer: "https://id.example.com",
      clientId: "client-id",
      checks: ["pkce", "state"],
      authorization: { params: { scope: "openid profile email" } },
    });
  });
});

describe("Pocket ID sign-in (subject binding)", () => {
  it("refuses an unbound subject even when the email matches an existing user", async () => {
    const result = await pocketIdSignIn(
      {
        account: account("sub-attacker"),
        profile: { sub: "sub-attacker", email: owner.email, email_verified: true },
      },
      null,
    );

    expect(result).toBe(`/signin?error=${POCKET_ID_NOT_LINKED_ERROR}`);
    await expect(
      pocketIdJwt({}, account("sub-attacker")),
    ).rejects.toThrow();
    expect(db.identities).toHaveLength(0);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("logs a bound subject into exactly that user, whatever email it reports", async () => {
    db.identities = [{ userId: other.id, provider: POCKET_ID_PROVIDER_ID, subject: "sub-2" }];

    const result = await pocketIdSignIn(
      { account: account("sub-2"), profile: { sub: "sub-2", email: owner.email } },
      null,
    );
    const token = await pocketIdJwt({ sub: "sub-2", email: owner.email }, account("sub-2"));

    expect(result).toBe(true);
    expect(token).toMatchObject({ id: other.id, sub: other.id, email: other.email });
  });

  it("reads the link intent from the cookie and refuses without one", async () => {
    const result = await pocketIdSignIn({ account: account("sub-x") });

    expect(cookieStore.get).toHaveBeenCalledWith(POCKET_ID_LINK_COOKIE);
    expect(result).toBe(`/signin?error=${POCKET_ID_NOT_LINKED_ERROR}`);
    expect(db.identities).toHaveLength(0);
  });

  it("leaves credential logins alone", async () => {
    await expect(
      pocketIdSignIn({
        account: { provider: "credentials", type: "credentials", providerAccountId: "x" },
      }),
    ).resolves.toBe(true);
    expect(prisma.oidcIdentity.findUnique).not.toHaveBeenCalled();
  });
});

describe("Connecting Pocket ID (signed-in user only)", () => {
  it("binds the subject to the user named by a valid link intent", async () => {
    cookieStore.get.mockReturnValue({ value: createLinkIntent(owner.id) });

    const result = await pocketIdSignIn({ account: account("sub-1") });

    expect(result).toBe(true);
    expect(cookieStore.delete).toHaveBeenCalledWith(POCKET_ID_LINK_COOKIE);
    expect(db.identities).toEqual([
      { userId: owner.id, provider: POCKET_ID_PROVIDER_ID, subject: "sub-1" },
    ]);
    const token = await pocketIdJwt({}, account("sub-1"));
    expect(token).toMatchObject({ id: owner.id });
  });

  it("ignores a forged or expired link intent", async () => {
    const forged = `${owner.id}.${Math.floor(Date.now() / 1000) + 600}.AAAA`;
    expect(verifyLinkIntent(forged)).toBeNull();
    const expired = createLinkIntent(owner.id, Date.now() - 3_600_000);
    expect(verifyLinkIntent(expired)).toBeNull();
    const tampered = createLinkIntent(owner.id).replace(owner.id, other.id);
    expect(verifyLinkIntent(tampered)).toBeNull();

    cookieStore.get.mockReturnValue({ value: forged });
    const result = await pocketIdSignIn({ account: account("sub-1") });

    expect(result).toBe(`/signin?error=${POCKET_ID_NOT_LINKED_ERROR}`);
    expect(db.identities).toHaveLength(0);
  });

  it("refuses to move a subject that is already bound to another user", async () => {
    db.identities = [{ userId: other.id, provider: POCKET_ID_PROVIDER_ID, subject: "sub-2" }];

    const result = await pocketIdSignIn({ account: account("sub-2") }, owner.id);

    expect(result).toBe(`/dashboard/settings?pocketIdError=${POCKET_ID_ALREADY_LINKED_ERROR}`);
    expect(db.identities).toEqual([
      { userId: other.id, provider: POCKET_ID_PROVIDER_ID, subject: "sub-2" },
    ]);
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
