"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/modules/auth/session";
import type { ActionState } from "@/lib/action-state";

/**
 * Grant a team member access to a document.
 *
 * No ownership check is written here: the `document_access_insert` policy calls
 * `can_manage_document`, so a non-owner simply gets a policy violation back.
 */
export async function grantDocumentAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");

  if (!documentId || !userId) return { error: "Choose a team member." };
  if (userId === profile.id) return { error: "You already own this document." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_access")
    .insert({ document_id: documentId, user_id: userId, granted_by: profile.id });

  if (error) {
    if (error.code === "23505") return { error: "They already have access." };
    return { error: "You are not allowed to share this document." };
  }

  revalidatePath(`/documents/${documentId}`);
  return { success: "Access granted." };
}

/** Withdraw a previously granted access. */
export async function revokeDocumentAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");

  if (!documentId || !userId) return { error: "Missing details." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_access")
    .delete()
    .eq("document_id", documentId)
    .eq("user_id", userId);

  if (error) return { error: "You are not allowed to change sharing here." };

  revalidatePath(`/documents/${documentId}`);
  return { success: "Access revoked." };
}
