"use client";

const DATABASE_NAME = "aic-documents-offline";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const UPLOAD_STORE = "uploads";
const DEVICE_KEY = "aic-documents:offline-device-id";

export type OfflineDocument = {
  key: string;
  id: string;
  userId: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  cachedAt: string;
  expiresAt: string;
  lastValidatedAt: string;
  blob: Blob;
};

export type QueuedUpload = {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  title: string;
  description: string;
  tags: string;
  blob: Blob;
  createdAt: string;
  documentId?: string;
  storagePath?: string;
  token?: string;
  uploaded?: boolean;
  lastError?: string;
};

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Offline storage is not available in this browser."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(UPLOAD_STORE)) {
        db.createObjectStore(UPLOAD_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
  });
}

async function transact<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Offline storage operation failed."));
    };
    // A successful request is not yet a durable write. Resolve only after the
    // transaction commits so "persist before network" is actually true.
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Offline storage transaction failed."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("Offline storage transaction was aborted."));
    };
  });
}

export function offlineDocumentKey(userId: string, documentId: string) {
  return `${userId}:${documentId}`;
}

export function getOfflineDeviceId(): string {
  const existing = window.localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_KEY, id);
  return id;
}

export async function saveOfflineDocument(document: OfflineDocument) {
  await transact(DOCUMENT_STORE, "readwrite", (store) => store.put(document));
}

export async function listOfflineDocuments(userId?: string) {
  const documents = await transact<OfflineDocument[]>(DOCUMENT_STORE, "readonly", (store) =>
    store.getAll(),
  );
  return userId ? documents.filter((document) => document.userId === userId) : documents;
}

export async function removeOfflineDocument(userId: string, documentId: string) {
  await transact(DOCUMENT_STORE, "readwrite", (store) =>
    store.delete(offlineDocumentKey(userId, documentId)),
  );
}

export async function purgeExpiredOfflineDocuments(now = Date.now()) {
  const documents = await listOfflineDocuments();
  const expired = documents.filter(
    (document) => new Date(document.expiresAt).getTime() <= now,
  );
  await Promise.all(
    expired.map((document) => removeOfflineDocument(document.userId, document.id)),
  );
  return expired.map((document) => document.id);
}

export async function clearOfflineData() {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([DOCUMENT_STORE, UPLOAD_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).clear();
    transaction.objectStore(UPLOAD_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear offline data."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Clearing offline data was aborted."));
  });
  db.close();
}

export async function saveQueuedUpload(upload: QueuedUpload) {
  await transact(UPLOAD_STORE, "readwrite", (store) => store.put(upload));
}

export async function listQueuedUploads(userId: string) {
  const uploads = await transact<QueuedUpload[]>(UPLOAD_STORE, "readonly", (store) =>
    store.getAll(),
  );
  return uploads
    .filter((upload) => upload.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeQueuedUpload(id: string) {
  await transact(UPLOAD_STORE, "readwrite", (store) => store.delete(id));
}
