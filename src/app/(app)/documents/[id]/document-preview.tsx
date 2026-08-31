"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * In-page preview for the formats a browser can render natively.
 *
 * The `src` is the same permission-checked download route the buttons use, so
 * the preview cannot show anything the user could not already open — it just
 * saves the round trip to a new tab. Formats a browser cannot render (Office
 * files) are not faked with a converter; they keep the Open/Download path.
 */

export function DocumentPreview({
  documentId,
  mimeType,
  title,
}: {
  documentId: string;
  mimeType: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const src = `/api/documents/${documentId}/download?disposition=inline`;

  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Preview
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Read it here without downloading a copy.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Show preview
        </Button>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Preview
        </h2>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Hide
        </Button>
      </div>

      {mimeType.startsWith("image/") ? (
        /* A plain <img>, not next/image: the source is a redirect to a 60-second
           signed URL, which the optimiser can neither cache nor re-fetch. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={title} className="max-h-[70vh] w-full object-contain" />
      ) : (
        <iframe
          src={src}
          title={title}
          className="h-[70vh] w-full bg-white dark:bg-neutral-900"
        />
      )}
    </Card>
  );
}
