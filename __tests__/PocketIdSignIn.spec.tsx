import { render, screen } from "@testing-library/react";
import AuthCard from "@/components/auth/AuthCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/actions/auth.actions", () => ({
  authenticate: vi.fn(),
  signup: vi.fn(),
  signInWithPocketId: vi.fn(),
}));

describe("Sign in with Pocket ID button", () => {
  it("is hidden when Pocket ID is not configured", () => {
    render(<AuthCard mode="signin" />);

    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /pocket id/i }),
    ).not.toBeInTheDocument();
  });

  it("shows next to the password login when configured", () => {
    render(<AuthCard mode="signin" pocketIdEnabled />);

    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in with Pocket ID" }),
    ).toBeInTheDocument();
  });

  it("shows the no-account error", () => {
    render(
      <AuthCard mode="signin" pocketIdEnabled pocketIdError="No JobSync account" />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("No JobSync account");
  });
});
