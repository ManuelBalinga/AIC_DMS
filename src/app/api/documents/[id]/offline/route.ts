import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/modules/auth/session";
import { STORAGE_BUCKET } from "@/modules/documents/constants";
import { getDocument } from "@/modules/documents/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_TTL_SECONDS = 5 * 60;

export async function POST(
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
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { deviceId?: unknown };
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  if (!UUID.test(deviceId)) {
    return NextResponse.json({ error: "Missing or malformed device id." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: leases, error: leaseError } = await supabase.rpc(
    "request_offline_document",
    { target_document_id: id, client_device_id: deviceId },
  );
  const lease = leases?.[0];
  if (leaseError || !lease) {
    return NextResponse.json(
      { error: "This document is not available offline." },
      { status: 403 },
    );
  }

  const { data, error } = await createAdminClient()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    return NextResponse.json({ error: "Could not prepare the offline copy." }, { status: 500 });
  }

  return NextResponse.json(
    {
      document: {
        id: document.id,
        title: document.title,
        fileName: document.file_name,
        mimeType: document.mime_type,
        sizeBytes: document.size_bytes,
      },
      url: data.signedUrl,
      expiresAt: lease.expires_at,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
