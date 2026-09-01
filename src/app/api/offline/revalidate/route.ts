import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/modules/auth/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    deviceId?: unknown;
    documentIds?: unknown;
  };
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const documentIds = Array.isArray(body.documentIds)
    ? body.documentIds.filter((id): id is string => typeof id === "string" && UUID.test(id))
    : [];

  if (!UUID.test(deviceId) || documentIds.length > 500) {
    return NextResponse.json({ error: "Invalid offline validation request." }, { status: 400 });
  }

  const { data, error } = await (await createClient()).rpc(
    "revalidate_offline_documents",
    { client_device_id: deviceId, target_document_ids: documentIds },
  );
  if (error) {
    return NextResponse.json({ error: "Offline access could not be checked." }, { status: 500 });
  }

  return NextResponse.json(
    {
      results: (data ?? []).map((row) => ({
        documentId: row.document_id,
        allowed: row.allowed,
        expiresAt: row.expires_at,
      })),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
