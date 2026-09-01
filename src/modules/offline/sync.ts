"use client";

import {
  getOfflineDeviceId,
  listOfflineDocuments,
  purgeExpiredOfflineDocuments,
  removeOfflineDocument,
  saveOfflineDocument,
} from "./storage";

type Revalidation = {
  documentId: string;
  allowed: boolean;
  expiresAt: string | null;
};

export async function revalidateOfflineDocuments(userId: string) {
  await purgeExpiredOfflineDocuments();
  const documents = await listOfflineDocuments(userId);
  if (documents.length === 0) return { kept: 0, purged: 0 };

  const response = await fetch("/api/offline/revalidate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: getOfflineDeviceId(),
      documentIds: documents.map((document) => document.id),
    }),
  });

  if (response.status === 401) {
    await Promise.all(
      documents.map((document) => removeOfflineDocument(document.userId, document.id)),
    );
    return { kept: 0, purged: documents.length };
  }
  if (!response.ok) throw new Error("Offline permissions could not be checked.");

  const { results } = (await response.json()) as { results: Revalidation[] };
  const byId = new Map(results.map((result) => [result.documentId, result]));
  let purged = 0;

  for (const document of documents) {
    const result = byId.get(document.id);
    if (!result?.allowed || !result.expiresAt) {
      await removeOfflineDocument(document.userId, document.id);
      purged += 1;
    } else {
      await saveOfflineDocument({
        ...document,
        expiresAt: result.expiresAt,
        lastValidatedAt: new Date().toISOString(),
      });
    }
  }

  return { kept: documents.length - purged, purged };
}
