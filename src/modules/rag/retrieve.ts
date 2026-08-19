import "server-only";

import { createClient } from "@/lib/supabase/server";
import { embedQuery, embeddingsConfigured } from "@/modules/rag/embed";
import {
  RETRIEVAL_CHUNK_COUNT,
  RETRIEVAL_MIN_SIMILARITY,
} from "@/modules/rag/config";
import type { RetrievedChunk } from "@/lib/types/database";

/**
 * Permission-aware retrieval (plan §6.4 steps 2–3).
 *
 * There is no permission filter in this file, and that is the design. Both RPCs
 * are SECURITY INVOKER and read `document_chunks`, whose RLS policy calls
 * `can_read_document`. The database removes passages from documents the caller
 * cannot open before this code ever sees them, so retrieval cannot leak a
 * restricted document by forgetting a `where` clause.
 */

export type Passage = RetrievedChunk & {
  /** Vector similarity, or keyword rank, depending on which arm found it. */
  score: number;
  matchedBy: "semantic" | "keyword";
};

export type RetrievalResult = {
  passages: Passage[];
  /** Set when semantic search was unavailable and only keywords were used. */
  degradedTo?: "keyword";
};

/**
 * Hybrid retrieval: vector similarity plus a keyword arm.
 *
 * Vector search alone misses exact identifiers — "i363", an invoice number, a
 * person's surname — because their embedding neighbourhood carries no signal
 * about the literal string. The keyword arm covers exactly those, and results
 * are merged with semantic hits ranked first.
 */
export async function retrievePassages(question: string): Promise<RetrievalResult> {
  const supabase = await createClient();
  const trimmed = question.trim();
  if (!trimmed) return { passages: [] };

  const byId = new Map<string, Passage>();

  const { data: keywordRows } = await supabase.rpc("search_document_chunks", {
    query_text: trimmed,
    match_count: RETRIEVAL_CHUNK_COUNT,
  });

  if (!embeddingsConfigured()) {
    for (const row of keywordRows ?? []) {
      byId.set(row.chunk_id, { ...row, score: row.rank, matchedBy: "keyword" });
    }
    return { passages: [...byId.values()], degradedTo: "keyword" };
  }

  const embedding = await embedQuery(trimmed);

  const { data: semanticRows } = await supabase.rpc("match_document_chunks", {
    query_embedding: embedding,
    match_count: RETRIEVAL_CHUNK_COUNT,
    min_similarity: RETRIEVAL_MIN_SIMILARITY,
  });

  for (const row of semanticRows ?? []) {
    byId.set(row.chunk_id, { ...row, score: row.similarity, matchedBy: "semantic" });
  }

  // Keyword hits are added second so a passage found both ways keeps its
  // similarity score and its position in the semantic ordering.
  for (const row of keywordRows ?? []) {
    if (!byId.has(row.chunk_id)) {
      byId.set(row.chunk_id, { ...row, score: row.rank, matchedBy: "keyword" });
    }
  }

  return { passages: [...byId.values()].slice(0, RETRIEVAL_CHUNK_COUNT) };
}
