"use server";
import prisma from "@/lib/db";
import { handleError } from "@/lib/utils";
import { requireUser } from "./shared";
import { revalidatePath } from "next/cache";
import { DEFAULT_PROFILE, mergeProfile, type FitProfile } from "@/lib/fit";
import { refreshStaleFits, refreshStaleReach } from "@/lib/fit/store";

// The fit profile is what makes the analysis personal: which technologies are
// yours, which disciplines you target, how many years you have. It rides along
// in UserSettings, so it needs no table and travels with the settings backup.

/** The stored profile, with defaults filled in for anything unset. */
export const getFitProfile = async (): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    const row = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    const stored = row ? (JSON.parse(row.settings)?.fit as Partial<FitProfile>) : undefined;
    return {
      success: true,
      data: { profile: mergeProfile(stored), custom: Boolean(stored) },
    };
  } catch (error) {
    return handleError(error, "Failed to load fit profile.");
  }
};

/**
 * Replace the profile with `profileJson`, or reset to the default when it is
 * empty. Every stored analysis goes stale on a change, so they are rebuilt
 * right here rather than left to drift.
 */
export const saveFitProfile = async (profileJson: string): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    const trimmed = (profileJson ?? "").trim();
    let fit: Partial<FitProfile> | undefined;
    if (trimmed) {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Profile must be a JSON object.");
      fit = parsed as Partial<FitProfile>;
      // Fail here rather than on every job: a broken pattern in the profile
      // would otherwise throw once per analysis, forever.
      mergeProfileOrThrow(fit);
    }

    const row = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    const settings = row ? JSON.parse(row.settings) : {};
    if (fit) settings.fit = fit;
    else delete settings.fit;
    const payload = JSON.stringify(settings);
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: { settings: payload },
      create: { userId: user.id, settings: payload },
    });

    const rebuilt = await refreshStaleFits(user.id);
    // The profile decides which technologies are the user's, so it moves the
    // analysis and the reachability built on top of it in the same breath.
    const rescored = await refreshStaleReach(user.id);
    revalidatePath("/dashboard");
    return {
      success: true,
      data: { rebuilt, rescored },
      message: `Profile saved; ${rebuilt} jobs re-analyzed, ${rescored} rescored.`,
    };
  } catch (error) {
    return handleError(error, "Failed to save fit profile.");
  }
};

/** Re-analyze every job whose stored analysis is out of date. */
export const recalculateFits = async (): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    const rebuilt = await refreshStaleFits(user.id);
    const rescored = await refreshStaleReach(user.id);
    revalidatePath("/dashboard");
    return {
      success: true,
      data: { rebuilt, rescored },
      message: `${rebuilt} jobs re-analyzed, ${rescored} rescored.`,
    };
  } catch (error) {
    return handleError(error, "Failed to recalculate fit data.");
  }
};

/**
 * Rescore reachability for every job it has moved for. Separate from the
 * analysis because it goes stale for a different reason: one new decision
 * changes the taste weights and with them every row in the table, and this
 * pass never touches a description.
 */
export const recalculateReach = async (): Promise<any | undefined> => {
  try {
    const user = await requireUser();
    const rescored = await refreshStaleReach(user.id);
    revalidatePath("/dashboard");
    return { success: true, data: { rescored }, message: `${rescored} jobs rescored.` };
  } catch (error) {
    return handleError(error, "Failed to recalculate reachability.");
  }
};

/** Compiles every pattern once so a bad profile fails at save time. */
function mergeProfileOrThrow(partial: Partial<FitProfile>) {
  const profile = mergeProfile(partial);
  const lists = [
    profile.wantRoles,
    profile.wantRolesPriority,
    ...Object.values(profile.skipRoles),
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) throw new Error("Role lists must be arrays of strings.");
    new RegExp(`(?:${list.join("|")})`, "iu");
  }
  for (const f of profile.foreignStacks) new RegExp(f.pattern, "i");
  for (const tier of Object.keys(DEFAULT_PROFILE.tiers)) {
    const terms = profile.tiers[tier as keyof typeof profile.tiers];
    if (!Array.isArray(terms)) throw new Error(`Tier ${tier} must be an array of strings.`);
  }
  return profile;
}
