"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/modules/auth/session";
import { STORAGE_BUCKET, parseTags } from "@/modules/documents/constants";
import { ingestDocument } from "@/modules/rag/ingest";
import type { ActionState } from "@/lib/action-state";

/**
 * Rename a document, edit its description, or change its tags.
 *
 * No ownership check is written here: the `documents_update_own` policy already
 * restricts this to the owner and administrators, so a non-owner gets zero rows
 * updated rather than a silent success.
 */
export async function updateDocument(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const tags = parseTags(String(formData.get("tags") ?? ""));

  if (!documentId) return { error: "Missing document." };
  if (!title) return { error: "A document needs a title." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ title, description: description || null, tags })
    .eq("id", documentId)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not update this document." };
  if (!data) return { error: "You are not allowed to edit this document." };

  revalidatePath("/dashboard");
  revalidatePath(`/documents/${documentId}`);
  return { success: "Document updated." };
}

/**
 * Delete a document and its stored bytes.
 *
 * The row is deleted first as the signed-in user, so the RLS delete policy is
 * the thing that decides whether this is allowed. Only once that succeeds do we
 * use the service-role client to remove the object.
 */
export async function deleteDocument(formData: FormData): Promise<void> {
  await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  if (!documentId) return;

  const supabase = await createClient();

  const { data: deleted, error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .select("storage_path")
    .maybeSingle();

  if (error || !deleted) return;

  await createAdminClient().storage.from(STORAGE_BUCKET).remove([deleted.storage_path]);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/**
 * Re-run AI indexing for one document.
 *
 * Reachable from the document page whenever indexing failed, or after the
 * accepted-format list changes. Gated on `can_manage_document` — a colleague
 * with read access should not be able to spend embedding budget.
 */
export async function reindexDocument(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  if (!documentId) return { error: "Missing document." };

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_manage_document", {
    check_document_id: documentId,
    check_user_id: profile.id,
  });

  if (!allowed) return { error: "Only the owner can re-index this document." };

  const result = await ingestDocument(documentId);

  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/dashboard");

  return result.ok
    ? { success: `Indexed ${result.chunkCount} passages.` }
    : { error: result.error };
}
