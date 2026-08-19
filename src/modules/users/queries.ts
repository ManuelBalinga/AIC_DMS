import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Invitation, Profile } from "@/lib/types/database";

/** Every internal user, for the admin roster and the document share picker. */
export async function listTeamMembers(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  return data ?? [];
}

/** Invitations that have not yet been accepted. Administrators only (RLS). */
export async function listPendingInvitations(): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invitations")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return data ?? [];
}
