import "server-only";

import { createClient } from "@/lib/supabase/server";
import { THREAD_PAGE_SIZE } from "@/modules/chat/config";
import type { ChatThread, ReferenceableDocument } from "@/lib/types/database";
import {
  displayName,
  type ChatPerson,
  type MessageWithSender,
} from "@/modules/chat/presentation";

export { displayName, type ChatPerson, type MessageWithSender } from "@/modules/chat/presentation";

/**
 * Reads over team messaging.
 *
 * No permission filter lives in this file. `chat_threads_select` exposes open
 * Teams and administrator-visible closed-Team metadata; `chat_messages_select`
 * separately exposes content only inside its reading boundary. Postgres has
 * already removed forbidden rows before this layer sees them.
 */

export type ThreadSummary = ChatThread & {
  /** Everyone in the thread, including the viewer. */
  participants: ChatPerson[];
  /** The viewer's own row, for read state. */
  lastReadAt: string | null;
  unreadCount: number;
  latestMessage: { body: string; sender_id: string | null; created_at: string } | null;
  /** Open teams and administrator metadata may be visible without membership. */
  viewerIsParticipant: boolean;
};

const MESSAGE_SELECT = `
  *,
  sender:profiles!chat_messages_sender_id_fkey (id, full_name, email),
  mentions:chat_mentions (
    mentioned_user_id,
    profile:profiles!chat_mentions_mentioned_user_id_fkey (id, full_name, email)
  ),
  reactions:chat_reactions (user_id, emoji),
  versions:chat_message_versions (id, body, created_at)
`;

/**
 * The inbox: every thread the viewer is in, most recently active first.
 *
 * Three queries rather than one join, because the join would repeat each
 * thread once per participant and the grouping is cheaper in memory than the
 * duplicated rows are over the wire.
 */
export async function listThreads(viewerId: string): Promise<ThreadSummary[]> {
  const supabase = await createClient();

  const { data: threads } = await supabase
    .from("chat_threads")
    .select("*")
    .order("last_message_at", { ascending: false })
    .returns<ChatThread[]>();

  if (!threads || threads.length === 0) return [];

  const ids = threads.map((thread) => thread.id);

  const [{ data: participantRows }, { data: messageRows }] = await Promise.all([
    supabase
      .from("chat_participants")
      .select("thread_id, user_id, last_read_at, profiles:profiles!inner (id, full_name, email)")
      .in("thread_id", ids)
      .returns<
        {
          thread_id: string;
          user_id: string;
          last_read_at: string | null;
          profiles: ChatPerson;
        }[]
      >(),
    supabase
      .from("chat_messages")
      .select("thread_id, body, sender_id, created_at")
      .in("thread_id", ids)
      .order("created_at", { ascending: false })
      .returns<
        { thread_id: string; body: string; sender_id: string | null; created_at: string }[]
      >(),
  ]);

  const participants = new Map<string, ChatPerson[]>();
  const lastRead = new Map<string, string | null>();
  for (const row of participantRows ?? []) {
    const list = participants.get(row.thread_id) ?? [];
    list.push(row.profiles);
    participants.set(row.thread_id, list);
    if (row.user_id === viewerId) lastRead.set(row.thread_id, row.last_read_at);
  }

  const latest = new Map<string, { body: string; sender_id: string | null; created_at: string }>();
  const unread = new Map<string, number>();
  for (const row of messageRows ?? []) {
    if (!latest.has(row.thread_id)) latest.set(row.thread_id, row);

    const viewerIsParticipant =
      participants
        .get(row.thread_id)
        ?.some((person) => person.id === viewerId) ?? false;
    if (!viewerIsParticipant) continue;

    // Your own messages are never unread, whatever the timestamps say — you
    // were there when they were sent.
    const readAt = lastRead.get(row.thread_id) ?? null;
    const isUnread =
      row.sender_id !== viewerId && (readAt === null || row.created_at > readAt);
    if (isUnread) unread.set(row.thread_id, (unread.get(row.thread_id) ?? 0) + 1);
  }

  return threads.map((thread) => ({
    ...thread,
    participants: participants.get(thread.id) ?? [],
    lastReadAt: lastRead.get(thread.id) ?? null,
    unreadCount: unread.get(thread.id) ?? 0,
    latestMessage: latest.get(thread.id) ?? null,
    viewerIsParticipant: participants
      .get(thread.id)
      ?.some((person) => person.id === viewerId) ?? false,
  }));
}

/**
 * One thread, or null when it is outside the viewer's discovery boundary.
 *
 * "Not visible" and "does not exist" deliberately produce the same answer. A
 * distinguishable 403 would confirm that a hidden conversation exists.
 */
export async function getThread(
  threadId: string,
  viewerId: string,
): Promise<ThreadSummary | null> {
  const supabase = await createClient();

  const { data: thread } = await supabase
    .from("chat_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle<ChatThread>();

  if (!thread) return null;

  const { data: participantRows } = await supabase
    .from("chat_participants")
    .select("user_id, last_read_at, profiles:profiles!inner (id, full_name, email)")
    .eq("thread_id", threadId)
    .returns<{ user_id: string; last_read_at: string | null; profiles: ChatPerson }[]>();

  return {
    ...thread,
    participants: (participantRows ?? []).map((row) => row.profiles),
    lastReadAt: null,
    unreadCount: 0,
    latestMessage: null,
    viewerIsParticipant: (participantRows ?? []).some(
      (row) => row.user_id === viewerId,
    ),
  };
}

/** The messages in a thread, oldest first, which is reading order. */
export async function listMessages(threadId: string): Promise<MessageWithSender[]> {
  const supabase = await createClient();

  const [{ data }, { data: references }] = await Promise.all([
    supabase
      .from("chat_messages")
      .select(MESSAGE_SELECT)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(THREAD_PAGE_SIZE)
      .returns<Omit<MessageWithSender, "document_references">[]>(),
    supabase.rpc("list_chat_document_references", { target_thread_id: threadId }),
  ]);

  const referencesByMessage = new Map<string, NonNullable<typeof references>>();
  for (const reference of references ?? []) {
    const list = referencesByMessage.get(reference.message_id) ?? [];
    list.push(reference);
    referencesByMessage.set(reference.message_id, list);
  }

  // Fetched newest-first so the limit keeps the *recent* end of a long thread,
  // then reversed for display. Ordering ascending with a limit would show
  // somebody the beginning of a conversation from last year.
  return (data ?? []).reverse().map((message) => ({
    ...message,
    document_references: referencesByMessage.get(message.id) ?? [],
  }));
}

/** Titles safe to show in a composer or reference card for this viewer. */
export async function listReferenceableDocuments(): Promise<ReferenceableDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_referenceable_documents");
  return data ?? [];
}

/** Total unread messages across every thread, for the nav badge. */
export async function countUnread(viewerId: string): Promise<number> {
  const threads = await listThreads(viewerId);
  return threads.reduce((total, thread) => total + thread.unreadCount, 0);
}

export type ChatNotificationSummary = {
  id: string;
  thread_id: string;
  message_id: string;
  kind: "mention" | "reply";
  created_at: string;
  actor: ChatPerson | null;
  thread: Pick<ChatThread, "kind" | "topic">;
};

export async function listUnreadChatNotifications(): Promise<{
  notifications: ChatNotificationSummary[];
  count: number;
}> {
  const supabase = await createClient();
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from("chat_notifications")
      .select(`
        id, thread_id, message_id, kind, created_at,
        actor:profiles!chat_notifications_actor_id_fkey (id, full_name, email),
        thread:chat_threads!chat_notifications_thread_id_fkey (kind, topic)
      `)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(12)
      .returns<ChatNotificationSummary[]>(),
    supabase
      .from("chat_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  return {
    notifications: error ? [] : data ?? [],
    count: count ?? 0,
  };
}

/** Everyone the viewer could start a conversation with. */
export async function listContactablePeople(viewerId: string): Promise<ChatPerson[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .neq("id", viewerId)
    .is("deactivated_at", null)
    .order("full_name", { ascending: true })
    .returns<ChatPerson[]>();

  return data ?? [];
}

/** What a thread is called in a list: its topic, or who else is in it. */
export function threadName(thread: ThreadSummary, viewerId: string): string {
  if (thread.kind === "team") return thread.topic?.trim() || "Untitled team";

  const others = thread.participants.filter((person) => person.id !== viewerId);
  if (others.length === 0) return "Just you";
  return others.map(displayName).join(", ");
}
