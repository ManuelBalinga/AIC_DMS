"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/modules/auth/session";
import {
  MAX_MESSAGE_LENGTH,
  MAX_TEAM_PURPOSE_LENGTH,
  MAX_TOPIC_LENGTH,
} from "@/modules/chat/config";
import { embedMessageInBackground } from "@/modules/chat/embed";
import { STORAGE_BUCKET, MAX_FILE_SIZE_BYTES, parseTags, sanitiseFileName } from "@/modules/documents/constants";
import { ingestDocument } from "@/modules/rag/ingest";
import {
  buildPromotedThreadMarkdown,
  MAX_PROMOTION_TITLE_LENGTH,
  PROMOTION_PAGE_SIZE,
  type PromotionMessage,
} from "@/modules/chat/promotion";
import type { ActionState } from "@/lib/action-state";
import type {
  ChatReactionEmoji,
  ChatTeamVisibility,
} from "@/lib/types/database";

const REACTION_EMOJIS: ChatReactionEmoji[] = ["👍", "❤️", "🎉", "👀", "✅"];
const TEAM_VISIBILITIES: ChatTeamVisibility[] = ["open", "closed"];

/**
 * Writes over team messaging.
 *
 * Permission is enforced by policy rather than by these functions. Sending
 * checks the request-aware `can_post_chat_message` helper and that the sender
 * is the caller in `chat_messages_insert`, so a forged `thread_id` or
 * `sender_id` fails at the database rather than at a validation branch somebody
 * might later delete.
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

/** Creates the team and its creator membership in one database transaction. */
export async function createTeam(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const name = String(formData.get("name") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  const visibility = String(
    formData.get("visibility") ?? "closed",
  ) as ChatTeamVisibility;

  if (!name) return { error: "Give the team a name." };
  if (name.length > MAX_TOPIC_LENGTH) {
    return { error: `Keep the team name under ${MAX_TOPIC_LENGTH} characters.` };
  }
  if (purpose.length > MAX_TEAM_PURPOSE_LENGTH) {
    return {
      error: `Keep the purpose under ${MAX_TEAM_PURPOSE_LENGTH} characters.`,
    };
  }
  if (!TEAM_VISIBILITIES.includes(visibility)) {
    return { error: "Choose whether the team is open or closed." };
  }

  const supabase = await createClient();
  const { data: threadId, error } = await supabase.rpc("create_team", {
    team_name: name,
    team_purpose: purpose,
    team_visibility: visibility,
  });

  if (error || !threadId) return { error: "That team could not be created." };

  revalidatePath("/messages");
  redirect(`/messages/${threadId}`);
}

export async function joinTeam(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();
  const threadId = String(formData.get("thread_id") ?? "").trim();
  if (!threadId) return { error: "Missing team." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_team", {
    target_thread_id: threadId,
  });
  if (error) return { error: "That open team could not be joined." };

  revalidatePath("/messages");
  revalidatePath(`/messages/${threadId}`);
  return { success: "Joined the team." };
}

export async function sendMessage(
  _prev: SendMessageState,
  formData: FormData,
): Promise<SendMessageState> {
  const profile = await requireProfile();

  const threadId = String(formData.get("thread_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const parentId = String(formData.get("parent_id") ?? "").trim() || null;
  const mentionedUserIds = formData
    .getAll("mentioned_user_ids")
    .map(String)
    .filter(Boolean);
  const referencedDocumentId = String(formData.get("referenced_document_id") ?? "").trim();
  const confirmedLockedReference = formData.get("confirm_locked_reference") === "true";
  const grantTeamReference = formData.get("reference_mode") === "grant_team";

  if (!threadId) return { error: "Missing conversation." };
  if (!body) return { error: "Write something first." };
  if (body.length > MAX_MESSAGE_LENGTH) {
    return { error: `Keep a message under ${MAX_MESSAGE_LENGTH} characters.` };
  }

  const supabase = await createClient();

  if (referencedDocumentId && !confirmedLockedReference && !grantTeamReference) {
    const { data: inaccessibleCount, error: gapError } = await supabase.rpc(
      "document_reference_gap_count",
      { target_thread_id: threadId, target_document_id: referencedDocumentId },
    );
    if (gapError) return { error: "That document could not be referenced." };
    if ((inaccessibleCount ?? 0) > 0) {
      const [{ data: thread }, { data: canManageDocument }] = await Promise.all([
        supabase.from("chat_threads").select("kind").eq("id", threadId).maybeSingle(),
        supabase.rpc("can_manage_document", {
          check_document_id: referencedDocumentId,
          check_user_id: profile.id,
        }),
      ]);
      return {
        referenceWarning: {
          documentId: referencedDocumentId,
          inaccessibleCount: inaccessibleCount ?? 0,
          canGrantTeam: thread?.kind === "team" && canManageDocument === true,
        },
      };
    }
  }

  const { data: messageId, error } = await supabase.rpc("send_chat_message", {
    target_thread_id: threadId,
    message_body: body,
    reply_to_id: parentId,
    mentioned_user_ids: mentionedUserIds,
    referenced_document_ids: referencedDocumentId ? [referencedDocumentId] : [],
    reference_mode: grantTeamReference
      ? "grant_team"
      : confirmedLockedReference
        ? "locked"
        : "require_access",
  });

  if (error || !messageId) {
    return { error: "That message could not be sent." };
  }

  // After the insert, and not awaited: see `embed.ts`.
  embedMessageInBackground(messageId);

  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
  return { success: "Sent." };
}

export type SendMessageState = ActionState & {
  referenceWarning?: {
    documentId: string;
    inaccessibleCount: number;
    canGrantTeam: boolean;
  };
};

/**
 * Snapshot a conversation into the ordinary document lifecycle.
 *
 * Reads happen as the caller, so RLS—not the service client—decides which
 * conversation may be copied. The service client is used only to place the
 * generated Markdown bytes in the private bucket. The RPC then creates the
 * document and, for a Team, its Viewer grant in one database transaction.
 */
export async function promoteThreadToDocument(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const threadId = String(formData.get("thread_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const tags = parseTags(String(formData.get("tags") ?? ""));

  if (!threadId) return { error: "Missing conversation." };
  if (!title) return { error: "Give the document a title." };
  if (title.length > MAX_PROMOTION_TITLE_LENGTH || /[\r\n]/.test(title)) {
    return { error: `Keep the title to ${MAX_PROMOTION_TITLE_LENGTH} characters on one line.` };
  }

  const supabase = await createClient();
  const [{ data: thread }, { data: membership }] = await Promise.all([
    supabase
      .from("chat_threads")
      .select("id, kind, topic")
      .eq("id", threadId)
      .maybeSingle(),
    supabase
      .from("chat_participants")
      .select("user_id")
      .eq("thread_id", threadId)
      .eq("user_id", profile.id)
      .maybeSingle(),
  ]);

  if (!thread || !membership) {
    return { error: "Only a conversation participant can promote it." };
  }

  const messages: PromotionMessage[] = [];
  for (let offset = 0; ; offset += PROMOTION_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("chat_messages")
      .select(`
        id, body, parent_id, created_at, edited_at, retracted_at,
        sender:profiles!chat_messages_sender_id_fkey (full_name, email)
      `)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PROMOTION_PAGE_SIZE - 1)
      .returns<PromotionMessage[]>();

    if (error) return { error: "The conversation could not be read." };
    messages.push(...(data ?? []));
    if ((data?.length ?? 0) < PROMOTION_PAGE_SIZE) break;
  }

  if (messages.length === 0) {
    return { error: "Write at least one message before promoting this conversation." };
  }

  const documentId = crypto.randomUUID();
  const promotedAt = new Date().toISOString();
  const threadLabel = thread.kind === "team" ? thread.topic?.trim() || "Untitled team" : "Direct conversation";
  const markdown = buildPromotedThreadMarkdown({
    title,
    threadKind: thread.kind,
    threadName: threadLabel,
    promotedAt,
    messages,
  });
  const sizeBytes = Buffer.byteLength(markdown, "utf8");
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { error: "This conversation is too large for the 50 MB document limit." };
  }

  const date = promotedAt.slice(0, 10);
  const fileName = sanitiseFileName(`${threadLabel.toLowerCase().replace(/\s+/g, "-")}-${date}.md`);
  const storagePath = `${profile.id}/${documentId}/${fileName}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, Buffer.from(markdown, "utf8"), {
      contentType: "text/markdown",
      upsert: false,
    });

  if (uploadError) return { error: "The document file could not be created." };

  const description = thread.kind === "team"
    ? `Conversation snapshot promoted from Team #${threadLabel} on ${date}.`
    : `Private conversation snapshot promoted on ${date}.`;
  const { data: promotedId, error: promotionError } = await supabase.rpc(
    "promote_chat_thread_to_document",
    {
      target_thread_id: threadId,
      new_document_id: documentId,
      document_title: title,
      document_description: description,
      document_file_name: fileName,
      document_storage_path: storagePath,
      document_size_bytes: sizeBytes,
      document_tags: tags,
    },
  );

  if (promotionError || promotedId !== documentId) {
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return { error: "The conversation could not be promoted." };
  }

  after(async () => {
    try {
      await ingestDocument(documentId);
    } catch {
      // ingestDocument records the failure on the document itself.
    }
  });

  revalidatePath("/dashboard");
  revalidatePath(`/messages/${threadId}`);
  redirect(`/documents/${documentId}`);
}

export async function toggleReaction(formData: FormData): Promise<void> {
  const profile = await requireProfile();
  const messageId = String(formData.get("message_id") ?? "").trim();
  const threadId = String(formData.get("thread_id") ?? "").trim();
  const emoji = String(formData.get("emoji") ?? "") as ChatReactionEmoji;

  if (!messageId || !threadId || !REACTION_EMOJIS.includes(emoji)) return;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("chat_reactions")
    .select("message_id")
    .eq("message_id", messageId)
    .eq("user_id", profile.id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("chat_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", profile.id)
      .eq("emoji", emoji);
  } else {
    await supabase
      .from("chat_reactions")
      .insert({ message_id: messageId, user_id: profile.id, emoji });
  }

  revalidatePath(`/messages/${threadId}`);
}

export async function editMessage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const messageId = String(formData.get("message_id") ?? "").trim();
  const threadId = String(formData.get("thread_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!messageId || !threadId) return { error: "Missing message." };
  if (!body) return { error: "A message cannot be empty." };
  if (body.length > MAX_MESSAGE_LENGTH) {
    return { error: `Keep a message under ${MAX_MESSAGE_LENGTH} characters.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .update({ body })
    .eq("id", messageId)
    .eq("thread_id", threadId)
    .eq("sender_id", profile.id)
    .is("retracted_at", null)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: "That message could not be edited." };

  embedMessageInBackground(messageId);
  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
  return { success: "Message updated." };
}

export async function retractMessage(formData: FormData): Promise<void> {
  const profile = await requireProfile();
  const messageId = String(formData.get("message_id") ?? "").trim();
  const threadId = String(formData.get("thread_id") ?? "").trim();
  if (!messageId || !threadId) return;

  const supabase = await createClient();
  await supabase
    .from("chat_messages")
    .update({ retracted_at: new Date().toISOString(), retracted_by: profile.id })
    .eq("id", messageId)
    .eq("thread_id", threadId)
    .eq("sender_id", profile.id)
    .is("retracted_at", null);

  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
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

export async function addTeamMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const threadId = String(formData.get("thread_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();

  if (!threadId || !userId) return { error: "Choose a team member." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_team_member", {
    target_thread_id: threadId,
    target_user_id: userId,
  });

  if (error) return { error: "That person could not be added to the team." };

  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
  return { success: "Added to the team." };
}

export async function removeTeamMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();
  const threadId = String(formData.get("thread_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();
  if (!threadId || !userId) return { error: "Missing team or person." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_team_member", {
    target_thread_id: threadId,
    target_user_id: userId,
  });
  if (error) return { error: "That person could not be removed from the team." };

  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
  return { success: "Removed from the team." };
}

export async function updateTeamDetails(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();
  const threadId = String(formData.get("thread_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  const visibility = String(
    formData.get("visibility") ?? "closed",
  ) as ChatTeamVisibility;

  if (!threadId) return { error: "Missing team." };
  if (!name) return { error: "Give the team a name." };
  if (name.length > MAX_TOPIC_LENGTH) {
    return { error: `Keep the team name under ${MAX_TOPIC_LENGTH} characters.` };
  }
  if (purpose.length > MAX_TEAM_PURPOSE_LENGTH) {
    return {
      error: `Keep the purpose under ${MAX_TEAM_PURPOSE_LENGTH} characters.`,
    };
  }
  if (!TEAM_VISIBILITIES.includes(visibility)) {
    return { error: "Choose whether the team is open or closed." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_threads")
    .update({ topic: name, purpose: purpose || null, visibility })
    .eq("id", threadId)
    .eq("kind", "team")
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: "Those team settings could not be saved." };

  revalidatePath(`/messages/${threadId}`);
  revalidatePath("/messages");
  return { success: "Team settings saved." };
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
