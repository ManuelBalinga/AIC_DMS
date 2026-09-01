"use client";

import { useActionState, useEffect, useState } from "react";

import { emptyActionState } from "@/lib/action-state";
import { Alert, Button, Card } from "@/components/ui";
import { setDocumentOfflineAllowed } from "@/modules/documents/actions";
import {
  getOfflineDeviceId,
  listOfflineDocuments,
  removeOfflineDocument,
  saveOfflineDocument,
  type OfflineDocument,
} from "@/modules/offline/storage";

type Props = {
  documentId: string;
  userId: string;
  offlineAllowed: boolean;
  isOwner: boolean;
};

export function OfflineDocumentControl({
  documentId,
  userId,
  offlineAllowed,
  isOwner,
}: Props) {
  const [cached, setCached] = useState<OfflineDocument | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [state, formAction] = useActionState(setDocumentOfflineAllowed, emptyActionState);

  useEffect(() => {
    void listOfflineDocuments(userId).then((items) => {
      setCached(items.find((item) => item.id === documentId) ?? null);
    });
  }, [documentId, userId]);

  async function cacheDocument() {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/offline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: getOfflineDeviceId() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
        expiresAt?: string;
        document?: {
          id: string;
          title: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
        };
      };
      if (!response.ok || !payload.url || !payload.expiresAt || !payload.document) {
        throw new Error(payload.error ?? "Could not prepare the offline copy.");
      }

      const bytes = await fetch(payload.url);
      if (!bytes.ok) throw new Error("The document bytes could not be downloaded.");
      const blob = await bytes.blob();
      const copy: OfflineDocument = {
        key: `${userId}:${documentId}`,
        id: documentId,
        userId,
        title: payload.document.title,
        fileName: payload.document.fileName,
        mimeType: payload.document.mimeType,
        sizeBytes: blob.size,
        cachedAt: new Date().toISOString(),
        expiresAt: payload.expiresAt,
        lastValidatedAt: new Date().toISOString(),
        blob,
      };
      await saveOfflineDocument(copy);
      setCached(copy);
      setNotice({ tone: "success", text: "Saved on this device for offline reading." });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not save this document offline.",
      });
    } finally {
      setPending(false);
    }
  }

  async function removeCopy() {
    await removeOfflineDocument(userId, documentId);
    setCached(null);
    setNotice({ tone: "success", text: "Offline copy removed from this device." });
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Offline access
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {cached
              ? `Available on this device until ${new Date(cached.expiresAt).toLocaleDateString("en-GB")}. Access is checked whenever you reconnect.`
              : offlineAllowed
                ? "Keep a browser copy for up to 30 days. Anyone with access to this browser profile may be able to read it."
                : "The owner has disabled offline copies for this document."}
          </p>
        </div>
        <div className="flex gap-2">
          {cached ? (
            <>
              <a href={`/offline?document=${documentId}`}><Button variant="secondary">Read offline</Button></a>
              <Button variant="ghost" onClick={() => void removeCopy()}>Remove copy</Button>
            </>
          ) : offlineAllowed ? (
            <Button disabled={pending} onClick={() => void cacheDocument()}>
              {pending ? "Saving…" : "Make available offline"}
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? <div className="mt-3"><Alert tone={notice.tone}>{notice.text}</Alert></div> : null}
      {state.error ? <div className="mt-3"><Alert tone="error">{state.error}</Alert></div> : null}
      {state.success ? <div className="mt-3"><Alert tone="success">{state.success}</Alert></div> : null}

      {isOwner ? (
        <form
          action={formAction}
          onSubmit={() => {
            if (offlineAllowed && cached) void removeCopy();
          }}
          className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800"
        >
          <input type="hidden" name="document_id" value={documentId} />
          <input type="hidden" name="offline_allowed" value={offlineAllowed ? "false" : "true"} />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Owner control: {offlineAllowed ? "new offline copies are allowed" : "offline copies are blocked"}.
          </p>
          <Button type="submit" variant="secondary">
            {offlineAllowed ? "Disable offline copies" : "Allow offline copies"}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
