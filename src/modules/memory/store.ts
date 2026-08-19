import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getRecentTurns } from "@/modules/memory/queries";
import { summariseOlderTurns, titleFromQuestion } from "@/modules/memory/context";
import {
  HISTORY_TURN_LIMIT,
  SUMMARY_TRIGGER_MESSAGES,
} from "@/modules/memory/config";
import type { AnswerSource } from "@/modules/rag/answer";
import type { Conversation, ConversationMessage } from "@/lib/types/database";

/**
 * Writes to conversation memory.
 *
 * Separate from `actions.ts` because these run inside the streaming answer
 * route rather than from a form: they must not call `revalidatePath`, which
 * would be a no-op mid-stream at best.
 */

/**
 * Resumes a thread, or starts one named after the question.
 *
 * A caller-supplied id is looked up rather than trusted. RLS would reject a
 * write to someone else's thread anyway, but failing here means an unknown id
 * quietly starts a new conversation instead of erroring halfway through an
 * answer the person is already watching stream in.
 */
export async function resumeOrCreateConversation(
  userId: string,
  conversationId: string | null,
  firstQuestion: string,
): Promise<Conversation> {
  const supabase = await createClient();

  if (conversationId) {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();

    if (data) return data;
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: titleFromQuestion(firstQuestion) })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Could not start a conversation: ${error?.message ?? "unknown"}`);
  }

  return data;
}

/**
 * Appends one turn.
 *
 * The sequence number comes from `next_message_seq` rather than a client-side
 * counter so two tabs asking at once cannot both claim the same position — the
 * unique constraint on `(conversation_id, seq)` turns that race into a failed
 * insert rather than a silently reordered thread.
 */
async function appendMessage(
  conversationId: string,
  message: {
    role: "user" | "assistant";
    content: string;
    retrievalMode?: string | null;
    passageCount?: number | null;
    resolvedQuery?: string | null;
  },
): Promise<ConversationMessage | null> {
  const supabase = await createClient();

  const { data: seq } = await supabase.rpc("next_message_seq", {
    target_conversation_id: conversationId,
  });

  const { data } = await supabase
    .from("conversation_messages")
    .insert({
      conversation_id: conversationId,
      seq: seq ?? 1,
      role: message.role,
      content: message.content,
      retrieval_mode: message.retrievalMode ?? null,
      passage_count: message.passageCount ?? null,
      resolved_query: message.resolvedQuery ?? null,
    })
    .select("*")
    .single();

  return data ?? null;
}

export async function recordQuestion(
  conversationId: string,
  question: string,
  resolvedQuery: string | null,
): Promise<ConversationMessage | null> {
  return appendMessage(conversationId, {
    role: "user",
    content: question,
    resolvedQuery,
  });
}

/**
 * Records an answer and the sources it was built on.
 *
 * Citations are inserted in a second statement rather than nested into the
 * message insert, because `message_citations` is keyed on the message id that
 * only exists once the first insert returns. A failure between the two leaves
 * an answer with no sources — readable, just not clickable — which is the right
 * way round for a partial write.
 */
export async function recordAnswer(
  conversationId: string,
  answer: string,
  sources: AnswerSource[],
  meta: { retrievalMode: string; passageCount: number },
): Promise<ConversationMessage | null> {
  const message = await appendMessage(conversationId, {
    role: "assistant",
    content: answer,
    retrievalMode: meta.retrievalMode,
    passageCount: meta.passageCount,
  });

  if (!message || sources.length === 0) return message;

  const supabase = await createClient();
  await supabase.from("message_citations").insert(
    sources.map((source) => ({
      message_id: message.id,
      position: source.number,
      document_id: source.documentId,
      document_title: source.documentTitle,
      page_number: source.pageNumber,
      excerpt: source.excerpt,
    })),
  );

  return message;
}

/**
 * Folds aged-out turns into the thread summary, once it is long enough to have
 * any.
 *
 * Called after an answer is already on screen, and every failure path returns
 * quietly: this is housekeeping for the *next* question, and nothing about it
 * is worth surfacing to the person who asked this one.
 */
export async function maintainSummary(conversation: Conversation): Promise<void> {
  if (conversation.message_count < SUMMARY_TRIGGER_MESSAGES) return;

  const supabase = await createClient();

  const summarisedThrough = conversation.summary_through_seq ?? 0;
  const keepFromSeq = Math.max(0, conversation.message_count - HISTORY_TURN_LIMIT);
  if (keepFromSeq <= summarisedThrough) return;

  const { data: aged } = await supabase
    .from("conversation_messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .gt("seq", summarisedThrough)
    .lte("seq", keepFromSeq)
    .order("seq", { ascending: true });

  if (!aged || aged.length === 0) return;

  const summary = await summariseOlderTurns(conversation.summary, aged);
  if (!summary) return;

  await supabase
    .from("conversations")
    .update({ summary, summary_through_seq: keepFromSeq })
    .eq("id", conversation.id);
}

/**
 * The tail of a thread plus its summary — everything a new question needs to
 * be understood in context.
 */
export async function loadWorkingMemory(conversation: Conversation): Promise<{
  turns: ConversationMessage[];
  summary: string | null;
}> {
  const turns = await getRecentTurns(conversation.id);
  return { turns, summary: conversation.summary };
}
