import "server-only";

import {
  CONTEXT_HEADER_MAX_CHARS,
  CONTEXT_SUMMARY_MAX_CHARS,
  CONTEXTUAL_EMBEDDINGS,
} from "@/modules/rag/config";
import type { Chunk } from "@/modules/rag/chunk";

/**
 * Situating a passage inside its document before it is embedded.
 *
 * The problem this solves is the one that makes naive RAG feel broken. Chunking
 * a document destroys the thing that made each passage meaningful: its place in
 * the whole. A chunk reading
 *
 *     The fee is GHS 500 per participant, payable before the first session.
 *
 * names neither the programme nor the year, so its embedding lands nowhere near
 * "what does the i363 programme cost in 2026?" — and the passage that holds the
 * answer is the one passage retrieval cannot find. The keyword arm does not
 * rescue it either: the question and the passage share almost no words.
 *
 * The fix is to embed the passage together with a short description of where it
 * came from, so the vector carries the document's identity as well as the
 * sentence's meaning.
 *
 * Two properties matter and are easy to get wrong:
 *
 *   1. The header is embedded but never stored in `content`, and never
 *      returned to the reader. A citation must quote what the document says,
 *      not a preamble this code wrote about it. It lives in its own column.
 *   2. The header is built from metadata the pipeline already has — the title,
 *      the tags, the summary ingestion generates anyway, the page number. It
 *      costs no extra model call per chunk. A per-chunk call would be the
 *      textbook version and would also multiply ingestion cost by the number of
 *      chunks, which for a 200-page PDF is not a rounding error.
 *
 * When there is no summary — no API key, or a summariser outage — the header
 * degrades to title, tags and page rather than disappearing. That is still most
 * of the benefit, and it keeps the promise that indexing works with no AI keys.
 */

export type DocumentContext = {
  title: string;
  tags: string[];
  /** The generated summary, when there is one. */
  summary: string | null;
};

/**
 * Builds the header for one chunk. Returns null when there is nothing useful
 * to say, so the caller stores null rather than an empty string.
 */
export function buildContextHeader(
  context: DocumentContext,
  chunk: Pick<Chunk, "pageNumber">,
): string | null {
  if (!CONTEXTUAL_EMBEDDINGS) return null;

  const lines: string[] = [];

  const title = context.title.trim();
  if (title) lines.push(`Document: ${title}`);

  const tags = context.tags.filter((tag) => tag.trim()).slice(0, 8);
  if (tags.length > 0) lines.push(`Tags: ${tags.join(", ")}`);

  if (context.summary) {
    // Truncated on a word boundary: a summary cut mid-word contributes a
    // fragment token to every single chunk's embedding.
    const summary = truncateWords(context.summary.trim(), CONTEXT_SUMMARY_MAX_CHARS);
    if (summary) lines.push(`This document is about: ${summary}`);
  }

  if (chunk.pageNumber !== null) lines.push(`From page ${chunk.pageNumber}.`);

  if (lines.length === 0) return null;

  return truncateWords(lines.join("\n"), CONTEXT_HEADER_MAX_CHARS);
}

/**
 * The text actually sent to the embedding provider: header, then the passage.
 *
 * Header first because it is the fixed part. Providers truncate from the end,
 * so a passage that overruns the model's input limit loses its tail rather than
 * its context — and the tail is already covered by the next chunk's overlap.
 */
export function embeddableText(content: string, header: string | null): string {
  return header ? `${header}\n\n${content}` : content;
}

function truncateWords(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");

  // Only fall back to a hard cut when there is no space in the whole window,
  // which means a single very long token rather than prose.
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
