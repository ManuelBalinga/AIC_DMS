import "server-only";

import { createClient } from "@/lib/supabase/server";
import { THREAD_PAGE_SIZE } from "@/modules/chat/config";
import type { ChatMessage, ChatThread, Profile } from "@/lib/types/database";

/**
 * Reads over team messaging.
 *
 * No permission filter in this file, for the same structural reason as every
 * other read layer here: `chat_threads_select`, `chat_participants_select` and
 * `chat_messages_select` all call `is_chat_participant`, so Postgres has
 * removed other people's conversations before this code sees a row. There is no
 * administrator exception to remember, because there is no administrator clause
 * to forget.
 */

export type ChatPerson = Pick<Profile, "id" | "full_name" | "email">;

export type ThreadSummary = ChatThread & {
  /** Everyone in the thread, including the viewer. */
  participants: ChatPerson[];
  /** The viewer's own row, for read state. */
  lastReadAt: string | null;
  unreadCount: number;
  latestMessage: { body: string; sender_id: string | null; created_at: string } | null;
};

export type MessageWithSender = ChatMessage & {
  sender: ChatPerson | null;
};

const SENDER_SELECT =
  "*, sender:profiles!chat_messages_sender_id_fkey (id, full_name, email)";

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
  }));
}

/**
 * One thread, or null when the viewer is not in it.
 *
 * "Not in it" and "does not exist" deliberately produce the same answer. A
 * distinguishable 403 would confirm that a given conversation exists, which is
 * itself something the viewer is not entitled to know.
 */
export async function getThread(threadId: string): Promise<ThreadSummary | null> {
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
  };
}

/** The messages in a thread, oldest first, which is reading order. */
export async function listMessages(threadId: string): Promise<MessageWithSender[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("chat_messages")
    .select(SENDER_SELECT)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(THREAD_PAGE_SIZE)
    .returns<MessageWithSender[]>();

  // Fetched newest-first so the limit keeps the *recent* end of a long thread,
  // then reversed for display. Ordering ascending with a limit would show
  // somebody the beginning of a conversation from last year.
  return (data ?? []).reverse();
}

/** Total unread messages across every thread, for the nav badge. */
export async function countUnread(viewerId: string): Promise<number> {
  const threads = await listThreads(viewerId);
  return threads.reduce((total, thread) => total + thread.unreadCount, 0);
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

/** How a person is shown when they have not set a display name. */
export function displayName(person: ChatPerson | null): string {
  if (!person) return "A former colleague";
  return person.full_name?.trim() || person.email;
}

/** What a thread is called in a list: its topic, or who else is in it. */
export function threadName(thread: ThreadSummary, viewerId: string): string {
  if (thread.topic?.trim()) return thread.topic.trim();

  const others = thread.participants.filter((person) => person.id !== viewerId);
  if (others.length === 0) return "Just you";
  return others.map(displayName).join(", ");
}
