import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/modules/auth/session";
import {
  MAX_FILE_SIZE_BYTES,
  STORAGE_BUCKET,
  isAcceptedMimeType,
  sanitiseFileName,
} from "@/modules/documents/constants";

/**
 * Step one of an upload: a short-lived permission to write one exact object.
 *
 * The file itself no longer passes through the application. It used to, and on
 * a serverless host that is a hard ceiling rather than a slow path — Vercel
 * caps a function's request body at 4.5 MB at the infrastructure level, which
 * cannot be raised from configuration or code. A 50 MB limit in
 * `constants.ts` and a 4.5 MB limit in the platform means every real document
 * fails, so the browser uploads straight to Supabase Storage instead and the
 * application only ever handles metadata.
 *
 * That is also the better shape independently of the host: pushing 50 MB
 * through an application server to hand it to a storage service is bandwidth
 * and latency spent to accomplish nothing.
 *
 * The path is computed here and never accepted from the caller. A signed upload
 * URL is a capability, and one whose target the client could choose would let
 * any signed-in person write into another person's folder. `documentId` is
 * minted here for the same reason.
 */
export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { fileName?: unknown; mimeType?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const size = typeof body.size === "number" ? body.size : NaN;

  if (!fileName.trim()) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }

  // These two checks are courtesy rather than enforcement: they fail the upload
  // before a large transfer starts instead of after. The binding checks run in
  // the metadata step against what storage actually received, because anything
  // the browser says about a file it has not yet sent is a claim, not a fact.
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "That file appears to be empty." }, { status: 400 });
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "That file is larger than the 50 MB limit." },
      { status: 413 },
    );
  }
  if (!isAcceptedMimeType(mimeType)) {
    return NextResponse.json(
      { error: `${mimeType || "That file type"} is not supported yet.` },
      { status: 415 },
    );
  }

  const documentId = crypto.randomUUID();
  const safeName = sanitiseFileName(fileName);
  const storagePath = `${profile.id}/${documentId}/${safeName}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    return NextResponse.json(
      { error: `Could not start the upload: ${error?.message ?? "unknown error"}` },
      { status: 500 },
    );
  }

  // `documentId` goes back so the browser can name it in the metadata call, and
  // that call recomputes the path from it rather than trusting the round trip.
  return NextResponse.json(
    { documentId, storagePath, token: data.token },
    { status: 200 },
  );
}
