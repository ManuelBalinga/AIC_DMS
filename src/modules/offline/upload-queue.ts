"use client";

import { createClient } from "@/lib/supabase/client";
import { STORAGE_BUCKET } from "@/modules/documents/constants";
import {
  listQueuedUploads,
  removeQueuedUpload,
  saveQueuedUpload,
  type QueuedUpload,
} from "./storage";

type Ticket = { documentId: string; storagePath: string; token: string };

async function responseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error ?? fallback;
}

export async function processQueuedUpload(upload: QueuedUpload): Promise<string> {
  let current = upload;

  if (!current.documentId || !current.storagePath || !current.token) {
    const response = await fetch("/api/documents/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: current.fileName,
        mimeType: current.mimeType,
        size: current.sizeBytes,
      }),
    });
    if (!response.ok) {
      const message = await responseError(response, "The upload could not be started.");
      await saveQueuedUpload({ ...current, lastError: message });
      throw new Error(message);
    }

    const ticket = (await response.json()) as Ticket;
    current = { ...current, ...ticket, lastError: undefined };
    await saveQueuedUpload(current);
  }

  if (!current.uploaded) {
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .uploadToSignedUrl(current.storagePath!, current.token!, current.blob, {
        contentType: current.mimeType,
      });
    if (error) {
      const message = `The file could not be uploaded: ${error.message}`;
      // Signed upload tokens expire. Discard only the ticket so reconnect can
      // mint a fresh document id/path/token while keeping the user's bytes.
      await saveQueuedUpload({
        ...current,
        documentId: undefined,
        storagePath: undefined,
        token: undefined,
        uploaded: false,
        lastError: message,
      });
      throw new Error(message);
    }

    current = { ...current, uploaded: true, lastError: undefined };
    await saveQueuedUpload(current);
  }

  const response = await fetch("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: current.documentId,
      fileName: current.fileName,
      title: current.title,
      description: current.description,
      tags: current.tags,
    }),
  });
  if (!response.ok) {
    const message = await responseError(response, "The upload could not be recorded.");
    await saveQueuedUpload({ ...current, lastError: message });
    throw new Error(message);
  }

  await removeQueuedUpload(current.id);
  return current.documentId!;
}

export async function flushQueuedUploads(userId: string) {
  const uploads = await listQueuedUploads(userId);
  let completed = 0;

  for (const upload of uploads) {
    try {
      await processQueuedUpload(upload);
      completed += 1;
    } catch {
      // `processQueuedUpload` persists every completed stage. Do not overwrite
      // that newer ticket/upload state with this older loop snapshot.
      break;
    }
  }

  return { completed, remaining: uploads.length - completed };
}
