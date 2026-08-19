"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/modules/auth/session";
import { TITLE_MAX_CHARS } from "@/modules/memory/config";
import type { ActionState } from "@/lib/action-state";

/**
 * Form-driven operations on conversation threads.
 *
 * As elsewhere, ownership is not re-checked in these functions. The
 * owner-only RLS policies on `conversations` mean a request for someone else's
 * thread affects zero rows, which each action reports as a refusal rather than
 * a silent success.
 */

/** Rename a thread, when the question-derived title is not what it was about. */
export async function renameConversation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const conversationId = String(formData.get("conversation_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();

  if (!conversationId) return { error: "Missing conversation." };
  if (!title) return { error: "A conversation needs a title." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ title: title.slice(0, TITLE_MAX_CHARS) })
    .eq("id", conversationId)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not rename this conversation." };
  if (!data) return { error: "That conversation is not yours to rename." };

  revalidatePath("/ask");
  return { success: "Conversation renamed." };
}

/**
 * Delete a thread and everything in it.
 *
 * Messages and citations go with it through `on delete cascade`, which is what
 * a person deleting a conversation means. There is no soft delete: the point of
 * the button is that the questions stop existing.
 */
export async function deleteConversation(formData: FormData): Promise<void> {
  await requireProfile();

  const conversationId = String(formData.get("conversation_id") ?? "");
  if (!conversationId) redirect("/ask");

  const supabase = await createClient();
  await supabase.from("conversations").delete().eq("id", conversationId);

  revalidatePath("/ask");
  redirect("/ask");
}
