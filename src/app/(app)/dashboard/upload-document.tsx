"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_SIZE_BYTES,
  formatFileSize,
} from "@/modules/documents/constants";
import { Alert, Button, Input, Label, Textarea } from "@/components/ui";
import { processQueuedUpload } from "@/modules/offline/upload-queue";
import {
  removeQueuedUpload,
  saveQueuedUpload,
  type QueuedUpload,
} from "@/modules/offline/storage";

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

type Status = "queued" | "uploading" | "done" | "saved";

type QueuedFile = {
  /** Stable across re-renders; `name` is not unique when two folders are dropped. */
  key: string;
  file: File;
  status: Status;
  error?: string;
};

export function UploadDocument({ userId }: { userId: string }) {
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
      // This key is also the durable IndexedDB key. A module counter restarts
      // on reload and could overwrite an older queued upload.
      added.push({ key: crypto.randomUUID(), file, status: "queued" });
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
  async function uploadOne(
    queueId: string,
    file: File,
    description: string,
    tags: string,
    title: string,
  ) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`${formatFileSize(file.size)} — over the 50 MB limit.`);
    }

    const upload: QueuedUpload = {
      id: queueId,
      userId,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      title,
      description,
      tags,
      blob: file,
      createdAt: new Date().toISOString(),
    };
    await saveQueuedUpload(upload);
    await processQueuedUpload(upload);
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
        await uploadOne(item.key, item.file, description, tags, singleTitle);
        setQueue((current) =>
          current.map((q) => (q.key === item.key ? { ...q, status: "done" } : q)),
        );
      } catch (cause) {
        failures += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        setQueue((current) =>
          current.map((q) => (q.key === item.key ? { ...q, status: "saved", error: message } : q)),
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
        `${failures} file${failures === 1 ? " was" : "s were"} saved on this device and will retry automatically when the connection is available.`,
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
      {/* Ruled off rather than boxed: this opens inside the page sheet, and a
          bordered card here would be a card inside a card. */}
      <div className="w-full border-y border-rule/30 bg-page-raised px-4 py-5">
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDropZone}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded-[2px] border border-dashed border-rule-faint bg-page-raised px-4 py-8 text-center transition-colors hover:border-rule hover:bg-brass/[0.05]"
          >
            <p className="text-sm font-medium text-ink">
              Drop files here, or click to choose
            </p>
            <p className="mt-1 text-xs text-ink-soft">
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
            <ul className="divide-y divide-rule-faint rounded-[2px] border border-rule-faint">
              {queue.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">
                      {item.file.name}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {formatFileSize(item.file.size)}
                      {item.error ? ` — ${item.error}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill status={item.status} />
                    {(item.status === "queued" || item.status === "saved") && !pending ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (item.status === "saved") void removeQueuedUpload(item.key);
                          setQueue((c) => c.filter((q) => q.key !== item.key));
                        }}
                        className="text-xs text-ink-soft underline underline-offset-2 hover:text-rule"
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
            <p className="text-xs text-ink-soft">
              Comma separated{queue.length > 1 ? ", applied to all of these files" : ""}. Tags are how
              documents get found once there are more than a screenful.
            </p>
          </div>

          {error ? <Alert tone="warning">{error}</Alert> : null}

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ink-soft">
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
      </div>
    </>
  );
}

function StatusPill({ status }: { status: Status }) {
  const label =
    status === "done"
      ? "Uploaded"
      : status === "saved"
        ? "Queued offline"
        : status === "uploading"
          ? "Uploading"
          : "Ready";
  const tone =
    status === "done"
      ? "text-cloth-edge"
      : status === "saved"
        ? "text-mark-open"
        : "text-ink-soft";
  return <span className={`text-xs font-medium ${tone}`}>{label}</span>;
}

/** Shown while files are dragged anywhere over the page. */
function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-cloth/70">
      <div className="rounded-[2px] border border-dashed border-brass px-8 py-6 text-center">
        <p className="text-lg font-medium text-page">Drop to upload</p>
        <p className="mt-1 text-sm text-parchment-soft">Several files at once is fine.</p>
      </div>
    </div>
  );
}
