import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DocumentRole, Invitation, Profile } from "@/lib/types/database";

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

export type PersonAccess = {
  owned: { id: string; title: string; created_at: string }[];
  shared: { id: string; title: string; role: DocumentRole; owner_id: string }[];
};

/**
 * Everything one person can reach.
 *
 * The question an administrator actually asks — usually when somebody leaves,
 * or when something has been shared that should not have been. Without this it
 * is answered by opening every document one at a time.
 *
 * Runs as the caller, so it is bounded by what the caller may see. Since
 * administrators keep visibility of document *rows* while losing their
 * contents, an administrator gets the full picture of who-can-reach-what
 * without gaining the ability to read any of it.
 */
export async function getPersonAccess(userId: string): Promise<PersonAccess> {
  const supabase = await createClient();

  const [owned, shared] = await Promise.all([
    supabase
      .from("documents")
      .select("id, title, created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("document_access")
      .select("role, document:documents!document_access_document_id_fkey (id, title, owner_id)")
      .eq("user_id", userId)
      .returns<
        { role: DocumentRole; document: { id: string; title: string; owner_id: string } | null }[]
      >(),
  ]);

  return {
    owned: owned.data ?? [],
    shared: (shared.data ?? [])
      .filter((row) => row.document !== null)
      .map((row) => ({
        id: row.document!.id,
        title: row.document!.title,
        role: row.role,
        owner_id: row.document!.owner_id,
      })),
  };
}
