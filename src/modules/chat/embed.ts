import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { embedQuery, embeddingsConfigured } from "@/modules/rag/embed";

/**
 * Making a sent message retrievable.
 *
 * Runs after the message is stored, never before: a message must send whether
 * or not an embedding provider is reachable. Messaging is the product's core
 * promise — replacing WhatsApp — and retrieval over it is a benefit layered on
 * top. If this never runs, the message is still delivered, still readable, and
 * still findable by keyword through `search_chat_messages`; it is only absent
 * from semantic search.
 *
 * Uses the service-role client for the same reason `ingest.ts` does, and under
 * the same constraint: it takes one message id and writes one column on that
 * row. It applies no caller-supplied filter and reads nothing back, so it
 * cannot become a way to see a conversation. Permission enforcement lives
 * entirely on the read side, in `chat_messages`' RLS policy.
 *
 * A message is embedded on its own rather than with its thread's history. That
 * is a deliberate limit: "sounds good to me" is genuinely not retrievable, and
 * inventing context for it by folding in surrounding messages would make it
 * match questions it cannot actually answer.
 *
 * Direct messages are skipped entirely. Migration 0009 already refuses to
 * return them from either retrieval function, so this is the second of two
 * layers rather than the one holding the line — but it is the layer that keeps
 * the vector from existing in the first place. A private conversation that was
 * never embedded cannot be exposed by a later change to a `where` clause, and
 * declining to compute the vector is also the honest reading of the decision:
 * a direct message is not a retrieval source, so there is nothing to index.
 */
export async function embedMessage(messageId: string): Promise<void> {
  if (!embeddingsConfigured()) return;

  const admin = createAdminClient();

  const { data: message } = await admin
    .from("chat_messages")
    .select("id, body, thread:chat_threads!inner(is_group)")
    .eq("id", messageId)
    .maybeSingle();

  if (!message) return;

  // `thread` arrives as an object for a to-one relationship, but the generated
  // types describe embedded resources as possibly-arrays. Normalising here
  // keeps the guard readable and, more importantly, keeps it fail-closed: an
  // unreadable or unexpected shape yields `undefined`, which is not `true`, so
  // the message is left unembedded rather than indexed by accident.
  const thread = Array.isArray(message.thread) ? message.thread[0] : message.thread;
  if (thread?.is_group !== true) return;

  const embedding = await embedQuery(message.body);

  await admin
    .from("chat_messages")
    .update({ embedding: embedding as unknown as string })
    .eq("id", messageId);
}

/**
 * Fire-and-forget, so sending a message never waits on the embedding provider.
 *
 * A person pressing Enter should see their message appear; they should not
 * watch a spinner while a vector is computed for a search they are not running.
 */
export function embedMessageInBackground(messageId: string): void {
  void embedMessage(messageId).catch(() => {
    // The message is sent and keyword-searchable either way. There is nothing
    // useful to do with this rejection, and surfacing it would report a
    // successful send as a failure.
  });
}
