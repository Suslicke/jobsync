import {
  connectPocketId,
  signInWithPocketId,
} from "@/actions/pocketId.actions";
import { signIn } from "@/auth";
import { setLinkIntentCookie } from "@/lib/auth/pocketId";
import { getCurrentUser } from "@/utils/user.utils";

vi.mock("@/auth", () => ({ signIn: vi.fn(), auth: vi.fn() }));
vi.mock("@/utils/user.utils", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/pocketId", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/pocketId")>()),
  isPocketIdEnabled: vi.fn(() => true),
  setLinkIntentCookie: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ default: {} }));

describe("Pocket ID actions", () => {
  it("connect refuses when nobody is signed in and sets no link cookie", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    await expect(connectPocketId()).rejects.toThrow("Not authenticated");
    expect(setLinkIntentCookie).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("connect mints the link cookie for the signed-in user, then starts OIDC", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
    });

    await connectPocketId();

    expect(setLinkIntentCookie).toHaveBeenCalledWith("user-1");
    expect(signIn).toHaveBeenCalledWith("pocket-id", {
      redirectTo: "/dashboard/settings?pocketId=linked",
    });
  });

  it("plain sign-in sets no link cookie", async () => {
    await signInWithPocketId();

    expect(setLinkIntentCookie).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith("pocket-id", { redirectTo: "/dashboard" });
  });
});
