import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/database";

export type DocumentGrant = {
  user_id: string;
  created_at: string;
  profile: Pick<Profile, "id" | "email" | "full_name" | "role"> | null;
};

/** Everyone who has been granted access to a document, excluding the owner. */
export async function listDocumentGrants(documentId: string): Promise<DocumentGrant[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("document_access")
    .select("user_id, created_at, profile:profiles!document_access_user_id_fkey (id, email, full_name, role)")
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  return (data as DocumentGrant[] | null) ?? [];
}
