import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  ChatTeamVisibility,
  DocumentRole,
  Profile,
} from "@/lib/types/database";

export type DocumentGrant = {
  user_id: string;
  role: DocumentRole;
  created_at: string;
  profile: Pick<Profile, "id" | "email" | "full_name" | "role"> | null;
};

export type DocumentTeamGrant = {
  team_id: string;
  role: DocumentRole;
  created_at: string;
  team: {
    id: string;
    topic: string | null;
    visibility: ChatTeamVisibility | null;
  } | null;
};

export type ShareableTeam = {
  id: string;
  topic: string | null;
  visibility: ChatTeamVisibility | null;
};

/** Everyone who has been granted access to a document, excluding the owner. */
export async function listDocumentGrants(documentId: string): Promise<DocumentGrant[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("document_access")
    .select("user_id, role, created_at, profile:profiles!document_access_user_id_fkey (id, email, full_name, role)")
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  return (data as DocumentGrant[] | null) ?? [];
}

/** Team grants on one document. RLS limits this management view to its owner/admin. */
export async function listDocumentTeamGrants(
  documentId: string,
): Promise<DocumentTeamGrant[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("document_team_access")
    .select("team_id, role, created_at, team:chat_threads!document_team_access_team_id_fkey (id, topic, visibility)")
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  return (data as DocumentTeamGrant[] | null) ?? [];
}

/** Teams the caller is allowed to discover and therefore allowed to target. */
export async function listShareableTeams(): Promise<ShareableTeam[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_threads")
    .select("id, topic, visibility")
    .eq("kind", "team")
    .order("topic", { ascending: true })
    .returns<ShareableTeam[]>();

  return data ?? [];
}

/** Count only; titles remain hidden. Used for the add-member consequence prompt. */
export async function getTeamDocumentGrantCount(teamId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_document_grant_count", {
    target_team_id: teamId,
  });

  return error ? 0 : Number(data ?? 0);
}
