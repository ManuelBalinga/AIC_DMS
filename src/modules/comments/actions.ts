"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/modules/auth/session";
import type { ActionState } from "@/lib/action-state";

/**
 * Writing and resolving comments.
 *
 * Permission is enforced by policy, not here: inserting calls
 * `can_comment_on_document`, so a Viewer's attempt fails at the database rather
 * than relying on the form having hidden the box.
 */

/** Longest a single comment may be. Past this it is a document, not a note. */
const MAX_COMMENT_LENGTH = 4000;

export async function postComment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const parentId = String(formData.get("parent_id") ?? "") || null;
  const rawPage = String(formData.get("page_number") ?? "").trim();
  const quotedText = String(formData.get("quoted_text") ?? "").trim() || null;

  if (!documentId) return { error: "Missing document." };
  if (!body) return { error: "Write something first." };
  if (body.length > MAX_COMMENT_LENGTH) {
    return { error: `Keep a comment under ${MAX_COMMENT_LENGTH} characters.` };
  }

  const pageNumber = rawPage ? Number.parseInt(rawPage, 10) : null;
  if (pageNumber !== null && (!Number.isFinite(pageNumber) || pageNumber < 1)) {
    return { error: "That page number is not valid." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("document_comments").insert({
    document_id: documentId,
    author_id: profile.id,
    // A reply belongs to its thread, not to a page of its own — carrying the
    // parent's placement would put the same marker in the margin twice.
    parent_id: parentId,
    body,
    page_number: parentId ? null : pageNumber,
    quoted_text: parentId ? null : quotedText,
  });

  if (error) {
    return { error: "You do not have permission to comment on this document." };
  }

  revalidatePath(`/documents/${documentId}`);
  return { success: parentId ? "Reply posted." : "Comment posted." };
}

/**
 * Mark a thread settled, or reopen it.
 *
 * Allowed for the comment's author and for whoever can manage the document —
 * an owner needs to close out review on their own document without being able
 * to edit what anybody said. The policy enforces both halves.
 */
export async function toggleCommentResolved(formData: FormData): Promise<void> {
  const profile = await requireProfile();

  const commentId = String(formData.get("comment_id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  const resolve = String(formData.get("resolve") ?? "") === "true";

  if (!commentId || !documentId) return;

  const supabase = await createClient();
  await supabase
    .from("document_comments")
    .update({
      resolved_at: resolve ? new Date().toISOString() : null,
      resolved_by: resolve ? profile.id : null,
    })
    .eq("id", commentId);

  revalidatePath(`/documents/${documentId}`);
}

/** Delete your own comment. Nobody else's — the policy sees to that. */
export async function deleteComment(formData: FormData): Promise<void> {
  await requireProfile();

  const commentId = String(formData.get("comment_id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  if (!commentId || !documentId) return;

  const supabase = await createClient();
  await supabase.from("document_comments").delete().eq("id", commentId);

  revalidatePath(`/documents/${documentId}`);
}
