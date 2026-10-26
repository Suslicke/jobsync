"use server";

import { signIn } from "@/auth";
import { requireUser } from "./shared";
import {
  POCKET_ID_PROVIDER_ID,
  POCKET_ID_SETTINGS_PATH,
  clearLinkIntentCookie,
  getPocketIdLinkForUser,
  isPocketIdEnabled,
  setLinkIntentCookie,
  unlinkPocketIdForUser,
} from "@/lib/auth/pocketId";

// Browser-only actions (excluded from the MCP action catalog).

function assertEnabled() {
  if (!isPocketIdEnabled()) {
    throw new Error("Pocket ID login is not configured.");
  }
}

// "Sign in with Pocket ID" on /signin. signIn() throws a redirect to Pocket ID,
// so it must not sit in a try/catch.
export async function signInWithPocketId() {
  assertEnabled();
  await clearLinkIntentCookie();
  await signIn(POCKET_ID_PROVIDER_ID, { redirectTo: "/dashboard" });
}

// Settings -> Connect Pocket ID. Only a signed-in user can start this: the
// signed link cookie names that user, and the Pocket ID callback binds the
// returned subject to exactly that user.
export async function connectPocketId() {
  assertEnabled();
  const user = await requireUser();
  await setLinkIntentCookie(user.id);
  await signIn(POCKET_ID_PROVIDER_ID, {
    redirectTo: `${POCKET_ID_SETTINGS_PATH}?pocketId=linked`,
  });
}

export async function disconnectPocketId(): Promise<{ success: boolean }> {
  const user = await requireUser();
  await unlinkPocketIdForUser(user.id);
  return { success: true };
}

export async function getPocketIdStatus(): Promise<{
  enabled: boolean;
  linked: boolean;
  linkedAt: Date | null;
}> {
  const enabled = isPocketIdEnabled();
  const user = await requireUser();
  const link = await getPocketIdLinkForUser(user.id);
  return { enabled, linked: !!link, linkedAt: link?.createdAt ?? null };
}
