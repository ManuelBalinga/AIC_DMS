import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/modules/auth/session";
import { getDocument } from "@/modules/documents/queries";
import { STORAGE_BUCKET } from "@/modules/documents/constants";
import { hasOfficePreview, renderOfficePreview } from "@/modules/documents/office-preview";

/**
 * Readable HTML for a format the browser cannot render itself.
 *
 * Permission is enforced exactly as in the download route beside this one, and
 * for the same reason it must be: this returns document *contents*, so it is
 * every bit as sensitive as the bytes. `getDocument` runs as the signed-in
 * user, so an unauthorised document comes back null and never reaches the
 * point of being read. A missing document and a forbidden one get the same
 * 404, so the endpoint cannot be used to discover what exists.
 *
 * The bytes are fetched server-side and converted server-side. They are never
 * handed to a third-party viewer, which is the whole reason this route exists
 * rather than an embed pointing at Microsoft or Google.
 */
export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const document = await getDocument(id);

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  if (!hasOfficePreview(document.mime_type)) {
    return NextResponse.json(
      { error: "That format cannot be previewed here yet." },
      { status: 415 },
    );
  }

  const { data, error } = await createAdminClient()
    .storage.from(STORAGE_BUCKET)
    .download(document.storage_path);

  if (error || !data) {
    return NextResponse.json({ error: "Could not open that file." }, { status: 500 });
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const preview = await renderOfficePreview(buffer, document.mime_type);

  if (!preview.ok) {
    // 422 rather than 500: the file was read and simply cannot be shown, which
    // is a fact about the document rather than a fault the server should be
    // retried over.
    return NextResponse.json({ error: preview.reason }, { status: 422 });
  }

  return NextResponse.json({ kind: preview.kind, html: preview.html });
}
