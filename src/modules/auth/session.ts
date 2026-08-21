import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/database";

/** The signed-in user's profile, or null when there is no valid session. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  // A deactivated person may still be holding a valid session token. Checking
  // here rather than only at sign-in means their access ends at their next
  // request, not whenever the token happens to expire.
  if (profile.deactivated_at) {
    await supabase.auth.signOut();
    return null;
  }

  return profile;
}

/**
 * Profile of the signed-in user, redirecting to login when absent.
 * Use this at the top of every protected server component and action.
 */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** Same as requireProfile, but also enforces the administrator role. */
export async function requireAdministrator(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "administrator") redirect("/dashboard");
  return profile;
}

export function isAdministrator(profile: Profile | null): boolean {
  return profile?.role === "administrator";
}
