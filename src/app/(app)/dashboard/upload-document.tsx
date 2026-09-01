"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_SIZE_BYTES,
  STORAGE_BUCKET,
  formatFileSize,
} from "@/modules/documents/constants";
import { createClient } from "@/lib/supabase/client";
import { Alert, Button, Card, Input, Label, Textarea } from "@/components/ui";

/**
 * Uploading documents, one or many, by picking or by dropping.
 *
 * A queue rather than a single file, because the thing being replaced is a
 * WhatsApp thread where somebody sends eleven files in a row. Making them do
 * eleven round trips through a modal is how a tool gets abandoned for the one
 * it was meant to replace.
 *
 * Each file is uploaded independently and reports its own outcome. One failure
 * does not discard the rest: a 40 MB scan timing out must not take nine
 * successful uploads with it, and the person needs to know precisely which one
 * to retry rather than being told "the upload failed".
 *
 * Sequential rather than parallel. Each file is three requests — sign, store,
 * record — and firing thirty at once buys a little wall-clock at the cost of
 * rate limits and an unreadable progress list. The bottleneck is the network,
 * and the network is exactly what is unreliable in Accra.
 */

type Status = "queued" | "uploading" | "done" | "failed";

type QueuedFile = {
  /** Stable across re-renders; `name` is not unique when two folders are dropped. */
  key: string;
  file: File;
  status: Status;
  error?: string;
};

let nextKey = 0;

export function UploadDocument() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [draggingOverPage, setDraggingOverPage] = useState(false);

  const addFiles = useCallback((files: FileList | File[]) => {
    const added: QueuedFile[] = [];
    for (const file of Array.from(files)) {
      if (file.size === 0) continue;
      added.push({ key: `f${nextKey++}`, file, status: "queued" });
    }
    if (added.length === 0) return;
    setQueue((current) => [...current, ...added]);
    setOpen(true);
    setError(null);
  }, []);

  /**
   * Dropping anywhere on the page, not only on a target you must first find.
   *
   * The browser's default for a dropped file is to navigate away and render it,
   * which loses whatever was typed. Both handlers must call preventDefault for
   * that not to happen, including on dragover — a drop listener alone is not
   * enough, and the failure mode is the page vanishing mid-upload.
   *
   * `dragenter`/`dragleave` fire for every child element crossed, so a plain
   * boolean flickers. Counting depth is what makes the overlay stable.
   */
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: globalThis.DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDraggingOverPage(true);
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
    };
    const onDragLeave = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDraggingOverPage(false);
    };
    const onDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDraggingOverPage(false);
      if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  function onDropZone(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
  }

  /** One file, all three steps. Throws with a message meant for the uploader. */
  async function uploadOne(file: File, description: string, tags: string, title: string) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`${formatFileSize(file.size)} — over the 50 MB limit.`);
    }

    const ticketResponse = await fetch("/api/documents/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, size: file.size }),
    });
    if (!ticketResponse.ok) {
      const payload = await ticketResponse.json().catch(() => ({}));
      throw new Error(payload.error ?? "Could not start the upload.");
    }
    const { documentId, storagePath, token } = await ticketResponse.json();

    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .uploadToSignedUrl(storagePath, token, file, { contentType: file.type });
    if (uploadError) throw new Error(uploadError.message);

    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentId,
        fileName: file.name,
        title,
        description,
        tags,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error ?? "Could not save the document record.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const description = String(formData.get("description") ?? "");
    const tags = String(formData.get("tags") ?? "");
    // A single title cannot describe eleven files, so it only applies when
    // there is one. Otherwise each document is titled by its own file name,
    // which is what the server falls back to anyway.
    const singleTitle = queue.length === 1 ? String(formData.get("title") ?? "") : "";

    const pendingFiles = queue.filter((item) => item.status !== "done");
    if (pendingFiles.length === 0) {
      setError("Choose at least one file to upload.");
      return;
    }

    setPending(true);
    let failures = 0;

    for (const item of pendingFiles) {
      setQueue((current) =>
        current.map((q) => (q.key === item.key ? { ...q, status: "uploading", error: undefined } : q)),
      );
      try {
        await uploadOne(item.file, description, tags, singleTitle);
        setQueue((current) =>
          current.map((q) => (q.key === item.key ? { ...q, status: "done" } : q)),
        );
      } catch (cause) {
        failures += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        setQueue((current) =>
          current.map((q) => (q.key === item.key ? { ...q, status: "failed", error: message } : q)),
        );
      }
    }

    setPending(false);
    router.refresh();

    if (failures === 0) {
      formRef.current?.reset();
      setQueue([]);
      setOpen(false);
    } else {
      setError(
        `${failures} of ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} failed. ` +
          "The rest were uploaded. Press Upload again to retry only the failures.",
      );
    }
  }

  const doneCount = queue.filter((q) => q.status === "done").length;

  if (!open) {
    return (
      <>
        <Button onClick={() => setOpen(true)}>Upload documents</Button>
        {draggingOverPage ? <DropOverlay /> : null}
      </>
    );
  }

  return (
    <>
      {draggingOverPage ? <DropOverlay /> : null}
      <Card className="w-full p-5">
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDropZone}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded-lg border-2 border-dashed border-neutral-300 px-4 py-8 text-center transition-colors hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-600"
          >
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Drop files here, or click to choose
            </p>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              PDF, Word, Excel, PowerPoint, text or image. Up to 50 MB each. Several at a time is fine.
            </p>
            <input
              ref={inputRef}
              id="file"
              name="file"
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) addFiles(event.target.files);
                // Cleared so choosing the same file twice still fires a change.
                event.target.value = "";
              }}
            />
          </div>

          {queue.length > 0 ? (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {queue.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-neutral-900 dark:text-neutral-100">
                      {item.file.name}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {formatFileSize(item.file.size)}
                      {item.error ? ` — ${item.error}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill status={item.status} />
                    {item.status === "queued" && !pending ? (
                      <button
                        type="button"
                        onClick={() => setQueue((c) => c.filter((q) => q.key !== item.key))}
                        className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {queue.length === 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" placeholder="Leave blank to use the file name" />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              placeholder={
                queue.length > 1
                  ? "Optional. Applied to all of these files."
                  : "Optional. What is this document for?"
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tags">Tags</Label>
            <Input id="tags" name="tags" placeholder="product docs, i363, updates" />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Comma separated{queue.length > 1 ? ", applied to all of these files" : ""}. Tags are how
              documents get found once there are more than a screenful.
            </p>
          </div>

          {error ? <Alert tone="error">{error}</Alert> : null}

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {doneCount > 0 ? `${doneCount} uploaded` : ""}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  setQueue([]);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || queue.length === 0}>
                {pending
                  ? "Uploading..."
                  : queue.length > 1
                    ? `Upload ${queue.filter((q) => q.status !== "done").length} files`
                    : "Upload"}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </>
  );
}

function StatusPill({ status }: { status: Status }) {
  const label =
    status === "done"
      ? "Uploaded"
      : status === "failed"
        ? "Failed"
        : status === "uploading"
          ? "Uploading"
          : "Ready";
  const tone =
    status === "done"
      ? "text-green-700 dark:text-green-400"
      : status === "failed"
        ? "text-red-700 dark:text-red-400"
        : "text-neutral-500 dark:text-neutral-400";
  return <span className={`text-xs font-medium ${tone}`}>{label}</span>;
}

/** Shown while files are dragged anywhere over the page. */
function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm">
      <div className="rounded-xl border-2 border-dashed border-white/80 px-8 py-6 text-center">
        <p className="text-lg font-medium text-white">Drop to upload</p>
        <p className="mt-1 text-sm text-white/80">Several files at once is fine.</p>
      </div>
    </div>
  );
}
