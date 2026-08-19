"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_SIZE_BYTES,
  formatFileSize,
} from "@/modules/documents/constants";
import { Alert, Button, Card, Input, Label, Textarea } from "@/components/ui";

export function UploadDocument() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`That file is ${formatFileSize(file.size)}. The limit is 50 MB.`);
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "The upload failed. Try again.");
        return;
      }

      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    } catch {
      setError("The upload failed. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Upload document</Button>;
  }

  return (
    <Card className="w-full p-5">
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="file">File</Label>
          <Input id="file" name="file" type="file" accept={ACCEPT_ATTRIBUTE} required />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            PDF, Word, Excel, PowerPoint, text or image. Up to 50 MB.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            name="title"
            placeholder="Leave blank to use the file name"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={2}
            placeholder="Optional. What is this document for?"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tags">Tags</Label>
          <Input
            id="tags"
            name="tags"
            placeholder="product docs, i363, updates"
          />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Comma separated. Tags are how documents get found once there are more
            than a screenful.
          </p>
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
