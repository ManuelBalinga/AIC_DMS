"use client";

import { useCallback, useState } from "react";

import { Alert, Button, Card } from "@/components/ui";
import { isOfficePreviewable } from "@/modules/documents/constants";

/**
 * In-page preview.
 *
 * Two routes to the same promise — read it here without downloading a copy.
 *
 * Formats the browser renders itself (PDF, images, text) go straight into an
 * iframe pointed at the permission-checked download route, so the preview can
 * never show anything the reader could not already open.
 *
 * Office formats are converted on our own server and arrive as sanitised HTML.
 * They are readable rather than faithful: headings, lists and tables survive; a
 * deck becomes its slide text; layout and images do not. That is the honest
 * trade for not sending an AIC document to Microsoft or Google to be rendered,
 * and Download remains there for when the layout is the point.
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
  const office = isOfficePreviewable(mimeType);

  const [html, setHtml] = useState<string | null>(null);
  const [kind, setKind] = useState<"html" | "text" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/preview`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "This file could not be previewed.");
        return;
      }
      setHtml(payload.html);
      setKind(payload.kind);
    } catch {
      setError("The preview could not be loaded. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  // Converting a large deck is not instant, so it starts when the reader asks
  // to see it, not on page load. Triggered from the click rather than from an
  // effect watching `open`: the fetch is a consequence of the action, and
  // expressing it as a render side-effect means re-running the guard on every
  // state change it itself causes.
  function show() {
    setOpen(true);
    if (office && html === null) void load();
  }

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
        <Button variant="secondary" onClick={show}>
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
      ) : office ? (
        <div className="max-h-[70vh] overflow-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Converting this file so it can be read here…
            </p>
          ) : error ? (
            <div className="space-y-3">
              <Alert tone="error">{error}</Alert>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Download still works, and opens it in the application it was made in.
              </p>
            </div>
          ) : html ? (
            <>
              <div
                className="office-preview prose prose-sm max-w-none dark:prose-invert"
                /* Server-rendered from the document and passed through an
                   allowlist there; see modules/documents/office-preview.ts.
                   Sanitising happens on the server rather than here because
                   the client is the one place it can be bypassed. */
                dangerouslySetInnerHTML={{ __html: html }}
              />
              <p className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                {kind === "text"
                  ? "Text only — this shows what the file says, not how it looks. Download for the original layout."
                  : "Converted for reading. Formatting is approximate; download for the original."}
              </p>
            </>
          ) : null}
        </div>
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
