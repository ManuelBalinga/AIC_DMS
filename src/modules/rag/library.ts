import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Library, LibraryDocument } from "@/modules/rag/library-format";

export { formatLibrary } from "@/modules/rag/library-format";
export type { Library, LibraryDocument } from "@/modules/rag/library-format";

/**
 * What the asker's collection looks like, as opposed to what is inside it.
 *
 * Retrieval answers "what does a document say". It cannot answer "how many
 * documents are there", "which is newest", or "do we hold anything on i363",
 * because none of those facts are written inside any document — they are
 * columns in a table, and a passage search has nothing to match them against.
 * Asked to count its own library, the model correctly said the passages did not
 * cover it, which is right and also useless to the person asking.
 *
 * So the collection is described to the model directly. This is a catalogue,
 * not a search: every document the asker may see, listed once, with the
 * metadata the database already holds and the summary the intelligence module
 * already wrote. The model can then answer questions about the shape of the
 * library from the catalogue, and questions about content from the passages,
 * and the two do not have to pretend to be the same thing.
 *
 * Permission works exactly as it does everywhere else here: this reads through
 * the signed-in user's client, so the `documents` select policy decides what
 * comes back and this file contains no filter of its own. One consequence is
 * deliberate and worth stating — an administrator sees titles and summaries for
 * documents they cannot open, because migration 0007 left them metadata to
 * manage access with while taking away contents. The catalogue inherits that
 * split rather than inventing a second answer to it.
 */

/** How many documents the catalogue will name before it stops. */
const CATALOGUE_LIMIT = 60;

/** Summaries are trimmed so one verbose document cannot crowd out the rest. */
const SUMMARY_MAX_CHARS = 220;

export async function getLibrary(): Promise<Library | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select("title, file_name, tags, summary, created_at, index_status")
    .order("created_at", { ascending: false })
    .limit(CATALOGUE_LIMIT + 1);

  if (error || !data) return null;

  const truncated = data.length > CATALOGUE_LIMIT;
  const rows = truncated ? data.slice(0, CATALOGUE_LIMIT) : data;

  const documents: LibraryDocument[] = rows.map((row) => ({
    title: row.title,
    fileName: row.file_name,
    tags: row.tags ?? [],
    summary: row.summary ? row.summary.trim().slice(0, SUMMARY_MAX_CHARS) : null,
    uploadedAt: row.created_at,
    indexed: row.index_status === "indexed",
  }));

  return {
    // `total` counts what was actually returned. A separate exact count query
    // would be more precise past the cap and would also be a second promise of
    // accuracy this cannot keep — the cap exists so the block stays readable,
    // and `truncated` is how the model learns not to claim a total.
    total: rows.length,
    indexed: documents.filter((d) => d.indexed).length,
    awaitingIndex: documents.filter((d) => !d.indexed).length,
    documents,
    truncated,
  };
}
