"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/modules/auth/session";
import { MAX_MESSAGE_LENGTH, MAX_TOPIC_LENGTH } from "@/modules/chat/config";
import { embedMessageInBackground } from "@/modules/chat/embed";
import type { ActionState } from "@/lib/action-state";

/**
 * Writes over team messaging.
 *
 * Permission is enforced by policy rather than by these functions. Sending
 * checks `is_chat_participant` *and* that the sender is the caller, both in the
 * `chat_messages_insert` policy — so a forged `thread_id` or `sender_id` in a
 * form post fails at the database, not at a validation branch somebody might
 * later delete.
 */

export async function startDirectThread(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const otherUserId = String(formData.get("user_id") ?? "").trim();

  if (!otherUserId) return { error: "Choose someone to message." };
  if (otherUserId === profile.id) {
    return { error: "You cannot start a conversation with yourself." };
  }

  const supabase = await createClient();

  // A database function rather than a select-then-insert here. Two people
  // opening each other's profile at the same moment would otherwise each find
  // no thread, each create one, and each send into a different conversation
  // that the other never sees.
  const { data: threadId, error } = await supabase.rpc("find_or_create_direct_thread", {
    other_user_id: otherUserId,
  });

  if (error || !threadId) {
    return { error: "That conversation could not be started." };
  }

  revalidatePath("/messages");
  redirect(`/messages/${threadId}`);
}

export async function sendMessage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const threadId = String(formData.get("thread_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!threadId) return { error: "Missing conversation." };
  if (!body) return { error: "Write something first." };
  if (body.length > MAX_MESSAGE_LENGTH) {
    return { error: `Keep a message under ${MAX_MESSAGE_LENGTH} characters.` };
  }

  const supabase = await createClient();

  const { data: inserted, error } = await supabase
    .from("chat_messages")
    .insert({ thread_id: threadId, sender_id: profile.id, body })
    .select("id")
    .maybeSingle();

  if (error || !inserted) {
    return { error: "That message could not be sent." };
  }

  // After the insert, and not awaited: see `embed.ts`.
  embedMessageInBackground(inserted.id);

  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
  return { success: "Sent." };
}

/**
 * Marks a thread read up to now.
 *
 * Called when a thread is opened. Failure is silent on purpose: a stale unread
 * badge is a cosmetic problem, and an error banner over a conversation the
 * person is already reading is a worse one.
 */
export async function markThreadRead(threadId: string): Promise<void> {
  const profile = await requireProfile();
  const supabase = await createClient();

  await supabase
    .from("chat_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("user_id", profile.id);

  revalidatePath("/messages");
}

export async function renameThread(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const threadId = String(formData.get("thread_id") ?? "").trim();
  const topic = String(formData.get("topic") ?? "").trim();

  if (!threadId) return { error: "Missing conversation." };
  if (topic.length > MAX_TOPIC_LENGTH) {
    return { error: `Keep a name under ${MAX_TOPIC_LENGTH} characters.` };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_threads")
    .update({ topic: topic || null })
    .eq("id", threadId);

  if (error) return { error: "That conversation could not be renamed." };

  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
  return { success: "Renamed." };
}

export async function addParticipant(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const threadId = String(formData.get("thread_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();

  if (!threadId || !userId) return { error: "Missing conversation or person." };

  const supabase = await createClient();

  const { error: joinError } = await supabase
    .from("chat_participants")
    .insert({ thread_id: threadId, user_id: userId });

  if (joinError) {
    return { error: "That person could not be added." };
  }

  // A thread with a third person in it is no longer a direct message, and must
  // stop being reusable as one — otherwise `find_or_create_direct_thread` could
  // hand two people a conversation a third is quietly reading.
  await supabase.from("chat_threads").update({ is_group: true }).eq("id", threadId);

  revalidatePath(`/messages/${threadId}`);
  return { success: "Added to the conversation." };
}

/**
 * Leaving a conversation.
 *
 * Removes only the caller's own participant row — the policy allows nothing
 * else, so being in a conversation never becomes a power over who else is.
 */
export async function leaveThread(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const threadId = String(formData.get("thread_id") ?? "").trim();

  if (!threadId) return { error: "Missing conversation." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_participants")
    .delete()
    .eq("thread_id", threadId)
    .eq("user_id", profile.id);

  if (error) return { error: "You could not leave that conversation." };

  revalidatePath("/messages");
  redirect("/messages");
}
