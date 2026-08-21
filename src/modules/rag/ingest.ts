import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/modules/documents/constants";
import { chunkPages } from "@/modules/rag/chunk";
import { buildContextHeader, embeddableText } from "@/modules/rag/contextualise";
import { embedAll, embeddingsConfigured } from "@/modules/rag/embed";
import { extractText } from "@/modules/rag/extract";
import { summariseDocument, suggestTags } from "@/modules/intelligence/summarise";
import type { DocumentIndexStatus } from "@/lib/types/database";

/**
 * Ingestion: document → extract → clean → chunk → embed → store (plan §9).
 *
 * Runs with the service-role client throughout, because it reads the private
 * storage bucket and writes chunks on behalf of the system rather than a user.
 * That is safe here because ingestion never takes a caller-supplied filter —
 * it is always "index exactly this one document, whole". Permission enforcement
 * happens on the *read* side, in `document_chunks`' RLS policy.
 *
 * Callers must check the caller's right to trigger it (see `reindexDocument`).
 */

export type IngestResult =
  | { ok: true; chunkCount: number; skipped?: string }
  | { ok: false; error: string };

async function setStatus(
  documentId: string,
  status: DocumentIndexStatus,
  extra: { chunkCount?: number; error?: string | null } = {},
) {
  await createAdminClient()
    .from("documents")
    .update({
      index_status: status,
      index_error: extra.error ?? null,
      chunk_count: extra.chunkCount ?? 0,
      indexed_at: status === "indexed" ? new Date().toISOString() : null,
    })
    .eq("id", documentId);
}

/**
 * The Phase 4 enrichments: a summary and suggested tags.
 *
 * This used to run *after* indexing, as a pure side effect. It now runs before
 * embedding and returns what it produced, because the summary is an input to
 * the context headers — a passage is situated using the document's own summary,
 * so the summary has to exist first (see `contextualise.ts`).
 *
 * Still swallows its own failures, and that guarantee is why it returns nulls
 * rather than throwing. A summariser outage costs the corpus better retrieval;
 * it must never cost the corpus its retrieval, and a document with no summary
 * still chunks, embeds, stores and answers questions.
 */
async function enrichDocument(
  title: string,
  existingTags: string[],
  pages: { text: string }[],
): Promise<{ summary: string | null; suggestedTags: string[] }> {
  try {
    const text = pages.map((page) => page.text).join("\n\n");

    const [summary, suggested] = await Promise.all([
      summariseDocument(title, text),
      suggestTags(title, text, existingTags),
    ]);

    return { summary, suggestedTags: suggested };
  } catch {
    return { summary: null, suggestedTags: [] };
  }
}

export async function ingestDocument(documentId: string): Promise<IngestResult> {
  const admin = createAdminClient();

  const { data: document, error: lookupError } = await admin
    .from("documents")
    .select("id, storage_path, mime_type, file_name, title, tags")
    .eq("id", documentId)
    .maybeSingle();

  if (lookupError || !document) {
    return { ok: false, error: "That document no longer exists." };
  }

  if (!embeddingsConfigured()) {
    const message =
      "AI indexing is not configured yet — no embedding provider key is set.";
    await setStatus(documentId, "pending", { error: message });
    return { ok: false, error: message };
  }

  await setStatus(documentId, "processing");

  try {
    const { data: blob, error: downloadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .download(document.storage_path);

    if (downloadError || !blob) {
      throw new Error(downloadError?.message ?? "Could not read the stored file.");
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const extracted = await extractText(buffer, document.mime_type);

    if (!extracted.ok) {
      // A format we deliberately do not index is not a failure to investigate,
      // so it is recorded as a reason rather than an error state.
      await setStatus(documentId, "failed", { error: extracted.reason });
      return { ok: true, chunkCount: 0, skipped: extracted.reason };
    }

    const chunks = chunkPages(extracted.pages);

    if (chunks.length === 0) {
      const reason =
        "No text could be read from this file. If it is a scan, it needs OCR.";
      await setStatus(documentId, "failed", { error: reason });
      return { ok: true, chunkCount: 0, skipped: reason };
    }

    const existingTags = document.tags ?? [];

    // Before embedding, not after: the summary is what tells each chunk which
    // document it belongs to, and a header written after the vectors exist
    // would be a header nothing was embedded with.
    const enrichment = await enrichDocument(
      document.title,
      existingTags,
      extracted.pages,
    );

    const headers = chunks.map((chunk) =>
      buildContextHeader(
        { title: document.title, tags: existingTags, summary: enrichment.summary },
        chunk,
      ),
    );

    const vectors = await embedAll(
      chunks.map((chunk, position) => embeddableText(chunk.content, headers[position])),
    );

    // Replace rather than merge: chunk indices are positional, so a re-index
    // after an edit would otherwise leave orphaned passages from the old text.
    await admin.from("document_chunks").delete().eq("document_id", documentId);

    const { error: insertError } = await admin.from("document_chunks").insert(
      chunks.map((chunk, position) => ({
        document_id: documentId,
        chunk_index: chunk.index,
        // `content` stays exactly what the document says. The header was an
        // input to the embedding and is stored beside it, never inside it,
        // because this column is what a citation quotes.
        content: chunk.content,
        context_header: headers[position],
        page_number: chunk.pageNumber,
        token_count: chunk.tokenEstimate,
        embedding: vectors[position],
      })),
    );

    if (insertError) throw new Error(insertError.message);

    await setStatus(documentId, "indexed", { chunkCount: chunks.length });

    // Persisted last, and non-fatally: the document is searchable by now, so a
    // failure to write the summary costs a nicety rather than the index.
    if (enrichment.summary || enrichment.suggestedTags.length > 0) {
      await admin
        .from("documents")
        .update({
          ...(enrichment.summary
            ? { summary: enrichment.summary, summary_generated_at: new Date().toISOString() }
            : {}),
          ...(enrichment.suggestedTags.length > 0
            ? { suggested_tags: enrichment.suggestedTags }
            : {}),
        })
        .eq("id", documentId);
    }

    return { ok: true, chunkCount: chunks.length };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await setStatus(documentId, "failed", { error: message });
    return { ok: false, error: message };
  }
}

/**
 * Fire-and-forget ingestion for the upload path.
 *
 * Upload must not block on embedding a 200-page PDF, and it must not fail if
 * indexing does — the document is stored and shareable either way, and the
 * document page surfaces the index status with a retry.
 */
export function ingestInBackground(documentId: string): void {
  void ingestDocument(documentId).catch(() => {
    // ingestDocument already records the failure on the document row; there is
    // nothing useful left to do with the rejection here.
  });
}
