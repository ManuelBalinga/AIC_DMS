import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  RELATED_DOCUMENT_COUNT,
  RELATED_MIN_SIMILARITY,
} from "@/modules/intelligence/config";
import type { RelatedDocument } from "@/lib/types/database";

/**
 * Reads over the Phase 4 intelligence layer.
 *
 * As everywhere else, no permission filter appears here. `related_documents`
 * is SECURITY INVOKER over a security-invoker view of `document_chunks`, so a
 * document the caller cannot read contributes nothing to the result — not even
 * its title, which is the part that would actually leak.
 */

/**
 * Documents that cover similar ground to this one.
 *
 * Returns an empty list rather than throwing when the corpus is too small or
 * nothing clears the similarity floor. "No related documents" is a normal
 * state, especially early on, and the UI simply omits the section.
 */
export async function getRelatedDocuments(
  documentId: string,
): Promise<RelatedDocument[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("related_documents", {
    source_document_id: documentId,
    match_count: RELATED_DOCUMENT_COUNT,
    min_similarity: RELATED_MIN_SIMILARITY,
  });

  if (error) return [];

  return data ?? [];
}
