import "server-only";

import { createClient } from "@/lib/supabase/server";
import { embedQuery, embeddingsConfigured } from "@/modules/rag/embed";
import {
  RETRIEVAL_CHUNK_COUNT,
  RETRIEVAL_MIN_SIMILARITY,
} from "@/modules/rag/config";
import {
  MESSAGE_MIN_SIMILARITY,
  MESSAGE_RETRIEVAL_COUNT,
} from "@/modules/chat/config";
import type { RetrievedChunk, RetrievedMessage } from "@/lib/types/database";

/**
 * Permission-aware retrieval (plan §6.4 steps 2–3).
 *
 * There is no permission filter in this file, and that is the design. All four
 * RPCs are SECURITY INVOKER. The document pair reads `document_chunks`, whose
 * policy calls `can_read_document`; the message pair reads `chat_messages`,
 * whose policy calls `is_chat_participant`. The database removes anything the
 * caller may not see before this code sees it, so retrieval cannot leak by
 * forgetting a `where` clause — there is no clause here to forget.
 *
 * Two kinds of source, deliberately kept distinct rather than flattened into
 * one "text" type. A document is a thing the organisation published; a message
 * is one person's remark to another. An answer that cites them identically
 * would let "I think we said 500" carry the same weight as the fee schedule,
 * and the reader could not tell which they were being given.
 */

type Scored = {
  score: number;
  matchedBy: "semantic" | "keyword";
};

export type DocumentPassage = RetrievedChunk & Scored & { kind: "document" };
export type MessagePassage = RetrievedMessage & Scored & { kind: "message" };
export type Passage = DocumentPassage | MessagePassage;

export type RetrievalResult = {
  passages: Passage[];
  /** Set when semantic search was unavailable and only keywords were used. */
  degradedTo?: "keyword";
};

/**
 * Hybrid retrieval over documents and the asker's own conversations.
 *
 * Vector search alone misses exact identifiers — "i363", an invoice number, a
 * person's surname — because their embedding neighbourhood carries no signal
 * about the literal string. The keyword arm covers exactly those.
 *
 * Documents are ranked ahead of messages in the returned list, whatever their
 * scores. That is a judgement, not an accident: where a document and a chat
 * message disagree, the document is the one the organisation stands behind,
 * and the model reads earlier passages as more authoritative.
 */
export async function retrievePassages(question: string): Promise<RetrievalResult> {
  const supabase = await createClient();
  const trimmed = question.trim();
  if (!trimmed) return { passages: [] };

  const documents = new Map<string, DocumentPassage>();
  const messages = new Map<string, MessagePassage>();

  const [{ data: keywordChunks }, { data: keywordMessages }] = await Promise.all([
    supabase.rpc("search_document_chunks", {
      query_text: trimmed,
      match_count: RETRIEVAL_CHUNK_COUNT,
    }),
    supabase.rpc("search_chat_messages", {
      query_text: trimmed,
      match_count: MESSAGE_RETRIEVAL_COUNT,
    }),
  ]);

  const addKeywordHits = () => {
    for (const row of keywordChunks ?? []) {
      if (!documents.has(row.chunk_id)) {
        documents.set(row.chunk_id, {
          ...row,
          kind: "document",
          score: row.rank,
          matchedBy: "keyword",
        });
      }
    }
    for (const row of keywordMessages ?? []) {
      if (!messages.has(row.message_id)) {
        messages.set(row.message_id, {
          ...row,
          kind: "message",
          score: row.rank,
          matchedBy: "keyword",
        });
      }
    }
  };

  if (!embeddingsConfigured()) {
    addKeywordHits();
    return { passages: assemble(documents, messages), degradedTo: "keyword" };
  }

  const embedding = await embedQuery(trimmed);

  const [{ data: semanticChunks }, { data: semanticMessages }] = await Promise.all([
    supabase.rpc("match_document_chunks", {
      query_embedding: embedding,
      match_count: RETRIEVAL_CHUNK_COUNT,
      min_similarity: RETRIEVAL_MIN_SIMILARITY,
    }),
    supabase.rpc("match_chat_messages", {
      query_embedding: embedding,
      match_count: MESSAGE_RETRIEVAL_COUNT,
      min_similarity: MESSAGE_MIN_SIMILARITY,
    }),
  ]);

  for (const row of semanticChunks ?? []) {
    documents.set(row.chunk_id, {
      ...row,
      kind: "document",
      score: row.similarity,
      matchedBy: "semantic",
    });
  }
  for (const row of semanticMessages ?? []) {
    messages.set(row.message_id, {
      ...row,
      kind: "message",
      score: row.similarity,
      matchedBy: "semantic",
    });
  }

  // Keyword hits are added second so a passage found both ways keeps its
  // similarity score and its position in the semantic ordering.
  addKeywordHits();

  return { passages: assemble(documents, messages) };
}

function assemble(
  documents: Map<string, DocumentPassage>,
  messages: Map<string, MessagePassage>,
): Passage[] {
  return [
    ...[...documents.values()].slice(0, RETRIEVAL_CHUNK_COUNT),
    ...[...messages.values()].slice(0, MESSAGE_RETRIEVAL_COUNT),
  ];
}
