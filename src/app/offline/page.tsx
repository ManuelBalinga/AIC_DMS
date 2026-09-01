"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button, Card, EmptyState } from "@/components/ui";
import {
  listOfflineDocuments,
  purgeExpiredOfflineDocuments,
  removeOfflineDocument,
  type OfflineDocument,
} from "@/modules/offline/storage";

export default function OfflineLibraryPage() {
  const [documents, setDocuments] = useState<OfflineDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void purgeExpiredOfflineDocuments().then(async () => {
      const saved = await listOfflineDocuments();
      setDocuments(saved);
      const requested = new URLSearchParams(window.location.search).get("document");
      setSelectedId(saved.some((item) => item.id === requested) ? requested : saved[0]?.id ?? null);
    });
  }, []);

  const selected = documents.find((item) => item.id === selectedId) ?? null;
  const objectUrl = useMemo(() => selected ? URL.createObjectURL(selected.blob) : null, [selected]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  async function remove(item: OfflineDocument) {
    await removeOfflineDocument(item.userId, item.id);
    const next = documents.filter((document) => document.key !== item.key);
    setDocuments(next);
    if (selectedId === item.id) setSelectedId(next[0]?.id ?? null);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl space-y-6 px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-600">Device library</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Available offline</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Copies expire after 30 days and are removed when access is revoked on reconnect.</p>
        </div>
        <Link href="/dashboard"><Button variant="secondary">Back to documents</Button></Link>
      </div>

      {documents.length === 0 ? (
        <EmptyState title="No offline documents" description="Open a document while connected and choose Make available offline." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <Card className="divide-y divide-neutral-200 overflow-hidden dark:divide-neutral-800">
            {documents.map((item) => (
              <button key={item.key} type="button" onClick={() => setSelectedId(item.id)} className={`block w-full px-4 py-3 text-left ${selectedId === item.id ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"}`}>
                <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.title}</span>
                <span className="mt-1 block text-xs text-neutral-500">Until {new Date(item.expiresAt).toLocaleDateString("en-GB")}</span>
              </button>
            ))}
          </Card>
          {selected && objectUrl ? (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{selected.title}</p><p className="truncate text-xs text-neutral-500">{selected.fileName}</p></div>
                <Button variant="ghost" onClick={() => void remove(selected)}>Remove</Button>
              </div>
              {selected.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={objectUrl} alt={selected.title} className="max-h-[70vh] w-full object-contain" />
              ) : (
                <iframe src={objectUrl} title={selected.title} className="h-[70vh] w-full" />
              )}
            </Card>
          ) : null}
        </div>
      )}
    </main>
  );
}
