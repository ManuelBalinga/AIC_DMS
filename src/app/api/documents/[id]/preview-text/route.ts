import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/modules/auth/session";
import { STORAGE_BUCKET } from "@/modules/documents/constants";
import { extractPdfPreviewText } from "@/modules/documents/pdf-preview-text";
import { getDocument } from "@/modules/documents/queries";

const PDF_MIME_TYPE = "application/pdf";
const MAX_PREVIEW_TEXT_CHARACTERS = 2_000_000;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

/** Permission-checked, page-separated text for selectable PDF comments. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json(
      { error: "Not signed in." },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const { id } = await params;
  const document = await getDocument(id);
  if (!document) {
    return NextResponse.json(
      { error: "Document not found." },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }

  if (document.mime_type !== PDF_MIME_TYPE) {
    return NextResponse.json(
      { error: "Selectable preview is available for PDF documents only." },
      { status: 415, headers: PRIVATE_HEADERS },
    );
  }

  const { data: blob, error: downloadError } = await createAdminClient()
    .storage.from(STORAGE_BUCKET)
    .download(document.storage_path);

  if (downloadError || !blob) {
    return NextResponse.json(
      { error: "Could not open that file." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const pages = await extractPdfPreviewText(
      Buffer.from(await blob.arrayBuffer()),
    );
    const characterCount = pages.reduce(
      (total, page) => total + page.text.length,
      0,
    );

    if (characterCount > MAX_PREVIEW_TEXT_CHARACTERS) {
      return NextResponse.json(
        { error: "This PDF is too large for the selectable preview." },
        { status: 413, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json({ pages }, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Could not read text from that PDF." },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }
}
