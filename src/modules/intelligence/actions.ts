"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/modules/auth/session";
import { MAX_TAGS_PER_DOCUMENT } from "@/modules/documents/constants";
import type { ActionState } from "@/lib/action-state";

/**
 * Accepting or dismissing the tags the model proposed.
 *
 * The whole point of `suggested_tags` being a separate column is that this
 * step exists: a suggestion becomes a tag when a person says so, never because
 * ingestion decided. Both actions clear the suggestion afterwards, so a
 * dismissed proposal does not come back on the next page load.
 *
 * Ownership is enforced by the `documents_update_own` policy, so a non-owner
 * updates zero rows and is told so, rather than silently succeeding.
 */

export async function acceptSuggestedTags(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  if (!documentId) return { error: "Missing document." };

  // Only the boxes actually ticked, not the whole suggestion list.
  const accepted = formData
    .getAll("tag")
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);

  const supabase = await createClient();

  const { data: document } = await supabase
    .from("documents")
    .select("tags, suggested_tags")
    .eq("id", documentId)
    .maybeSingle();

  if (!document) return { error: "That document is not yours to edit." };

  // Only accept things that were actually suggested. Without this the form
  // could be used to write arbitrary tags past the normal validation path.
  const offered = new Set(document.suggested_tags ?? []);
  const valid = accepted.filter((tag) => offered.has(tag));

  const merged = [...new Set([...(document.tags ?? []), ...valid])].slice(
    0,
    MAX_TAGS_PER_DOCUMENT,
  );

  const { data, error } = await supabase
    .from("documents")
    .update({ tags: merged, suggested_tags: [] })
    .eq("id", documentId)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not update the tags." };
  if (!data) return { error: "That document is not yours to edit." };

  revalidatePath("/dashboard");
  revalidatePath(`/documents/${documentId}`);

  return {
    success:
      valid.length > 0
        ? `Added ${valid.length} tag${valid.length === 1 ? "" : "s"}.`
        : "Suggestions dismissed.",
  };
}

export async function dismissSuggestedTags(formData: FormData): Promise<void> {
  await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  if (!documentId) return;

  const supabase = await createClient();
  await supabase
    .from("documents")
    .update({ suggested_tags: [] })
    .eq("id", documentId);

  revalidatePath(`/documents/${documentId}`);
}
