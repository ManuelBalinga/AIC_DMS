import { NextResponse, type NextRequest } from "next/server";

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
import { ingestInBackground } from "@/modules/rag/ingest";

/**
 * Document upload.
 *
 * A route handler rather than a server action so the request body streams
 * instead of being buffered against the server-action size limit. This is also
 * the natural place to enqueue Week 2 RAG ingestion once that module lands.
 */
export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const tags = parseTags(String(formData.get("tags") ?? ""));

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "That file is larger than the 50 MB limit." },
      { status: 413 },
    );
  }
  if (!isAcceptedMimeType(file.type)) {
    return NextResponse.json(
      { error: `${file.type || "That file type"} is not supported yet.` },
      { status: 415 },
    );
  }

  const documentId = crypto.randomUUID();
  const safeName = sanitiseFileName(file.name);
  const storagePath = `${profile.id}/${documentId}/${safeName}`;

  const adminClient = createAdminClient();
  const { error: uploadError } = await adminClient.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json(
      { error: `Could not store the file: ${uploadError.message}` },
      { status: 500 },
    );
  }

  // Inserted as the signed-in user so the RLS insert policy still applies.
  const supabase = await createClient();
  const { error: insertError } = await supabase.from("documents").insert({
    id: documentId,
    owner_id: profile.id,
    title: title || safeName,
    description: description || null,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
    tags,
  });

  if (insertError) {
    // Never leave an orphaned object behind.
    await adminClient.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: "Could not save the document record." },
      { status: 500 },
    );
  }

  // Plan §6.2 step 6: the document enters the AI ingestion pipeline. Not
  // awaited — a 200-page PDF takes far longer to embed than the uploader should
  // watch a spinner for, and the document is stored and shareable either way.
  ingestInBackground(documentId);

  return NextResponse.json({ id: documentId }, { status: 201 });
}
