import { Metadata } from "next";
import AuthCard from "@/components/auth/AuthCard";
import {
  POCKET_ID_NOT_LINKED_ERROR,
  isPocketIdEnabled,
} from "@/lib/auth/pocketId";

export const metadata: Metadata = {
  title: "Sign In",
};

// Pocket ID env is read at request time, not baked in at build time.
export const dynamic = "force-dynamic";

function pocketIdErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  if (error === POCKET_ID_NOT_LINKED_ERROR) {
    return "This Pocket ID account is not connected to JobSync. Sign in with your password, then connect Pocket ID in Settings → Sign-in.";
  }
  return "Sign-in with Pocket ID failed. Try again or use your password.";
}

export default async function Signin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const pocketIdEnabled = isPocketIdEnabled();
  const { error } = await searchParams;
  const errorCode = Array.isArray(error) ? error[0] : error;

  return (
    <AuthCard
      mode="signin"
      pocketIdEnabled={pocketIdEnabled}
      pocketIdError={pocketIdEnabled ? pocketIdErrorMessage(errorCode) : null}
    />
  );
}
