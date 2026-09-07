import { after, NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/modules/auth/session";
import {
  MAX_FILE_SIZE_BYTES,
  STORAGE_BUCKET,
  isAcceptedMimeType,
  parseTags,
  sanitiseFileName,
} from "@/modules/documents/constants";
import { ingestDocument } from "@/modules/rag/ingest";
import { startEvent, type WideEvent } from "@/lib/log";

/**
 * Step two of an upload: record the document now that its bytes are stored.
 *
 * The file arrived at Supabase Storage directly from the browser, through the
 * signed URL issued by `upload-url/route.ts` — see that file for why it no
 * longer streams through here. What is left is a small JSON body, which is what
 * makes this survivable on a serverless host.
 *
 * The security consequence of that split is the whole substance of this route.
 * Between the two calls the application saw nothing, so every fact about the
 * file has to be re-established here rather than accepted from the caller:
 *
 *   - The storage path is recomputed from the owner and the document id. A
 *     caller-supplied path would let a signed-in person attach somebody else's
 *     object — or a path outside their own folder — to a row they own.
 *   - Size and content type are read back from storage. What the browser said
 *     in step one was a claim about a file it had not yet sent; what storage
 *     holds is the file.
 *   - The object must actually exist. Otherwise a document row could be created
 *     pointing at nothing, which reads to every downstream feature as a file
 *     that failed to parse rather than one that was never uploaded.
 */
/**
 * Ingestion runs inside `after`, and `after` inherits this route's duration
 * ceiling. Left unset, the host picks its own default, which on a serverless
 * platform is short enough that a large PDF is extracted and embedded only
 * halfway before the invocation is killed. Sixty seconds is the most a Vercel
 * Hobby project allows; a paid plan can raise it, and a durable queue removes
 * the ceiling altogether.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const event = startEvent({
    event: "document_finalise",
    method: "POST",
    path: "/api/documents",
    request_id: request.headers.get("x-request-id"),
  });
  try {
    const response = await finaliseUpload(request, event);
    event.set({ status_code: response.status });
    return response;
  } catch (error) {
    // Rethrown so the platform still turns it into a 500; the event records it
    // on the way past rather than swallowing it in order to log it.
    event.fail(error, { status_code: 500 });
    throw error;
  } finally {
    // In `finally`, so a request that failed is exactly as well recorded as
    // one that succeeded. Those are the ones worth reading.
    event.end();
  }
}

async function finaliseUpload(request: NextRequest, event: WideEvent) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body." },
      { status: 400 },
    );
  }

  event.set({ user: { id: profile.id, role: profile.role } });

  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  const tags = parseTags(String(body.tags ?? ""));

  // A malformed id would otherwise become a storage path prefix, so it is
  // checked for shape before being used to build one.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      documentId,
    )
  ) {
    return NextResponse.json(
      { error: "Missing or malformed document id." },
      { status: 400 },
    );
  }
  if (!fileName.trim()) {
    return NextResponse.json({ error: "Missing file name." }, { status: 400 });
  }

  const safeName = sanitiseFileName(fileName);
  const storagePath = `${profile.id}/${documentId}/${safeName}`;
  const supabase = await createClient();

  // Finalisation is retry-safe: an interrupted browser may repeat this call
  // after Storage already accepted the bytes and the row was committed.
  const { data: existing } = await supabase
    .from("documents")
    .select("id, owner_id, storage_path, file_name")
    .eq("id", documentId)
    .maybeSingle();
  if (
    existing?.owner_id === profile.id &&
    existing.storage_path === storagePath &&
    existing.file_name === safeName
  ) {
    return NextResponse.json({ id: documentId }, { status: 200 });
  }

  const adminClient = createAdminClient();

  // What storage actually holds, which is the only account of the file that was
  // not written by the client.
  const { data: object, error: infoError } = await adminClient.storage
    .from(STORAGE_BUCKET)
    .info(storagePath);

  if (infoError || !object) {
    return NextResponse.json(
      { error: "That file was not uploaded. Try again." },
      { status: 409 },
    );
  }

  const actualSize = object.size ?? 0;
  const actualType = object.contentType ?? "";

  const discard = async (message: string, status: number) => {
    // The member sees `message`; the event keeps why, which is not the same
    // thing and is the half that was missing.
    event.set({ outcome: "rejected", reject_reason: message });
    await adminClient.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: message }, { status });
  };

  event.set({
    document: {
      id: documentId,
      mime_type: actualType,
      size_bytes: actualSize,
      tag_count: tags.length,
      named_by_uploader: Boolean(title),
    },
  });

  if (actualSize <= 0) {
    return discard("That file appears to be empty.", 400);
  }
  if (actualSize > MAX_FILE_SIZE_BYTES) {
    return discard("That file is larger than the 50 MB limit.", 413);
  }
  if (!isAcceptedMimeType(actualType)) {
    return discard(
      `${actualType || "That file type"} is not supported yet.`,
      415,
    );
  }

  // Inserted as the signed-in user so the RLS insert policy still applies.
  const { error: insertError } = await supabase.from("documents").insert({
    id: documentId,
    owner_id: profile.id,
    title: title || safeName,
    description: description || null,
    // The sanitised name, not the original: migration 0015 binds the row to its
    // stored object by requiring `storage_path` to equal
    // `{owner_id}/{id}/{file_name}`, and the path above is built from
    // `safeName`. Storing the raw name here made the two disagree for any file
    // whose name needed sanitising — which is every name containing a space —
    // and the trigger rejected the insert with "Document storage binding is
    // invalid". Sanitising is the security boundary and does not move; the row
    // moves to meet it. A human-readable name belongs in `title`.
    file_name: safeName,
    storage_path: storagePath,
    mime_type: actualType,
    size_bytes: actualSize,
    tags,
  });

  if (insertError) {
    const { data: retried } = await supabase
      .from("documents")
      .select("id, owner_id, storage_path, file_name")
      .eq("id", documentId)
      .maybeSingle();
    if (
      retried?.owner_id === profile.id &&
      retried.storage_path === storagePath &&
      retried.file_name === safeName
    ) {
      return NextResponse.json({ id: documentId }, { status: 200 });
    }
    // Never leave an orphaned object behind after a genuine insert failure.
    //
    // The member is shown a deliberately vague sentence, because an insert
    // error can carry a constraint name or a storage path. The cause goes here
    // instead. This is the field that would have said "Document storage
    // binding is invalid" the first time an upload failed, rather than leaving
    // four queued files and nothing to go on.
    event.fail(insertError, { failed_at: "documents_insert" });
    return discard("Could not save the document record.", 500);
  }

  // Plan §6.2 step 6: the document enters the AI ingestion pipeline.
  //
  // `after` rather than a bare floating promise. The old code called an
  // `ingestInBackground` helper that returned immediately, which works on a
  // long-lived server and silently does not on a serverless one: the invocation
  // is frozen once the response is sent, so indexing was killed part-way or
  // never ran, and the document row would sit at its initial index status
  // forever with nothing to show why. `after` tells the platform work is still
  // outstanding and keeps the invocation alive for it.
  //
  // It is not a queue, and the function's duration ceiling still applies — a
  // large PDF can exceed it. The document page's retry button is what covers
  // that today, and a durable queue remains the real fix.
  after(async () => {
    // A separate wide event, because this runs after the response has gone: it
    // is a second hop, tied to the first by document id and request id. Folding
    // it into the upload event would mean either holding that event open until
    // indexing finished, or emitting it without the outcome.
    const ingestEvent = startEvent({
      event: "document_ingest",
      request_id: request.headers.get("x-request-id"),
      document: {
        id: documentId,
        mime_type: actualType,
        size_bytes: actualSize,
      },
      user: { id: profile.id, role: profile.role },
    });
    try {
      const result = await ingestDocument(documentId);
      if (result.ok) {
        ingestEvent.set({
          chunk_count: result.chunkCount,
          skipped_reason: result.skipped ?? null,
        });
      } else {
        ingestEvent.fail(new Error(result.error), { failed_at: "ingest" });
      }
    } catch (error) {
      // ingestDocument records the failure on the document row too, which is
      // where the uploader looks. This is where somebody debugging looks.
      ingestEvent.fail(error, { failed_at: "ingest_threw" });
    } finally {
      ingestEvent.end();
    }
  });

  return NextResponse.json({ id: documentId }, { status: 201 });
}
