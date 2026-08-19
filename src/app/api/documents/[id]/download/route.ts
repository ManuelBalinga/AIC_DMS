import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/modules/auth/session";
import { getDocument } from "@/modules/documents/queries";
import { STORAGE_BUCKET } from "@/modules/documents/constants";

const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Hands back a short-lived signed URL for the document bytes.
 *
 * `getDocument` runs as the signed-in user, so an unauthorised document comes
 * back as null and never reaches the signing step. The bucket itself stays
 * private and unreachable from the browser.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const document = await getDocument(id);

  if (!document) {
    // Same response whether the document is missing or merely off-limits, so
    // the endpoint cannot be used to probe for document existence.
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const inline = request.nextUrl.searchParams.get("disposition") === "inline";

  const { data, error } = await createAdminClient()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: inline ? false : document.file_name,
    });

  if (error || !data) {
    return NextResponse.json({ error: "Could not open that file." }, { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
