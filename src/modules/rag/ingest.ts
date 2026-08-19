import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/modules/documents/constants";
import { chunkPages } from "@/modules/rag/chunk";
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
 * Writes the Phase 4 enrichments: a summary and suggested tags.
 *
 * Takes the already-extracted pages rather than re-reading the file, so this
 * costs one model call each and no additional storage round trip.
 *
 * Swallows its own failures on purpose. The document is indexed by the time
 * this runs; a null summary is a missing nicety, while a thrown error here
 * would mark a perfectly searchable document as failed.
 */
async function enrichDocument(
  documentId: string,
  title: string,
  existingTags: string[],
  pages: { text: string }[],
): Promise<void> {
  try {
    const text = pages.map((page) => page.text).join("\n\n");

    const [summary, suggested] = await Promise.all([
      summariseDocument(title, text),
      suggestTags(title, text, existingTags),
    ]);

    if (!summary && suggested.length === 0) return;

    await createAdminClient()
      .from("documents")
      .update({
        ...(summary ? { summary, summary_generated_at: new Date().toISOString() } : {}),
        ...(suggested.length > 0 ? { suggested_tags: suggested } : {}),
      })
      .eq("id", documentId);
  } catch {
    // Enrichment is optional by design; the document is already indexed.
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

    const vectors = await embedAll(chunks.map((chunk) => chunk.content));

    // Replace rather than merge: chunk indices are positional, so a re-index
    // after an edit would otherwise leave orphaned passages from the old text.
    await admin.from("document_chunks").delete().eq("document_id", documentId);

    const { error: insertError } = await admin.from("document_chunks").insert(
      chunks.map((chunk, position) => ({
        document_id: documentId,
        chunk_index: chunk.index,
        content: chunk.content,
        page_number: chunk.pageNumber,
        token_count: chunk.tokenEstimate,
        embedding: vectors[position],
      })),
    );

    if (insertError) throw new Error(insertError.message);

    await setStatus(documentId, "indexed", { chunkCount: chunks.length });

    // Phase 4 enrichment, after the document is already searchable. Deliberately
    // last and deliberately non-fatal: indexing is what makes a document useful,
    // and a summariser outage must not cost the corpus its retrieval.
    await enrichDocument(documentId, document.title, document.tags ?? [], extracted.pages);

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
