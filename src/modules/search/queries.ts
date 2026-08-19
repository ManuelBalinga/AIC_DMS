import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Full-text search inside document *content*, as opposed to the metadata
 * search on the dashboard.
 *
 * The two answer different questions. Metadata search finds the document you
 * already know the name of; this finds the document that mentions a thing
 * somewhere on page nine. Keeping them separate means the common case stays
 * fast and the list stays predictable.
 *
 * Runs through `search_document_chunks`, a SECURITY INVOKER function over
 * `document_chunks` — so results are already limited to documents the caller
 * can open.
 */

export type ContentMatch = {
  documentId: string;
  documentTitle: string;
  pageNumber: number | null;
  /** The matching passage, trimmed to something readable in a list. */
  snippet: string;
};

const SNIPPET_CHARS = 260;

export async function searchDocumentContent(
  query: string,
  limit = 6,
): Promise<ContentMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const supabase = await createClient();
  const { data } = await supabase.rpc("search_document_chunks", {
    query_text: trimmed,
    match_count: limit * 3,
  });

  const byDocument = new Map<string, ContentMatch>();

  for (const row of data ?? []) {
    // One row per document: three hits in the same file is one result to a
    // reader, not three.
    if (byDocument.has(row.document_id)) continue;

    const content = row.content.replace(/\s+/g, " ").trim();

    byDocument.set(row.document_id, {
      documentId: row.document_id,
      documentTitle: row.document_title,
      pageNumber: row.page_number,
      snippet:
        content.length > SNIPPET_CHARS
          ? `${content.slice(0, SNIPPET_CHARS).trim()}…`
          : content,
    });

    if (byDocument.size >= limit) break;
  }

  return [...byDocument.values()];
}
