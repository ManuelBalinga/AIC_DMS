import "server-only";

import { createClient } from "@/lib/supabase/server";
import { CONVERSATION_LIST_LIMIT, HISTORY_TURN_LIMIT } from "@/modules/memory/config";
import type {
  Conversation,
  ConversationMessage,
  MessageCitation,
} from "@/lib/types/database";

/**
 * Reads over conversation memory.
 *
 * As with documents, no query here filters by user. `conversations` and its two
 * child tables are owner-only under RLS, so a thread belonging to someone else
 * is not merely hidden from these queries — it does not exist as far as this
 * connection is concerned.
 */

export type MessageWithCitations = ConversationMessage & {
  citations: MessageCitation[];
};

/** The signed-in user's threads, most recently used first. */
export async function listConversations(): Promise<Conversation[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("conversations")
    .select("*")
    .order("last_message_at", { ascending: false })
    .limit(CONVERSATION_LIST_LIMIT);

  return data ?? [];
}

/** One thread, or null when it does not exist or belongs to someone else. */
export async function getConversation(id: string): Promise<Conversation | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return data ?? null;
}

/**
 * Every turn in a thread, in order, with the citations each answer was built on.
 *
 * One round trip rather than one per message: a thread of twenty answers would
 * otherwise be twenty-one queries to render a page.
 */
export async function getThread(
  conversationId: string,
): Promise<MessageWithCitations[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("conversation_messages")
    .select("*, citations:message_citations (*)")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: true })
    .returns<MessageWithCitations[]>();

  // Postgres does not order an embedded relation, so citation order is whatever
  // the join produced. The UI renders these as numbered sources, so sort here.
  return (data ?? []).map((message) => ({
    ...message,
    citations: [...(message.citations ?? [])].sort((a, b) => a.position - b.position),
  }));
}

/**
 * The tail of a thread, for replaying as working memory.
 *
 * Fetched newest-first and reversed rather than reading the whole thread and
 * slicing: on a long conversation the difference is between transferring every
 * turn ever asked and transferring the handful that will actually be sent to
 * the model.
 */
export async function getRecentTurns(
  conversationId: string,
  limit: number = HISTORY_TURN_LIMIT,
): Promise<ConversationMessage[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("conversation_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: false })
    .limit(limit);

  return (data ?? []).reverse();
}
