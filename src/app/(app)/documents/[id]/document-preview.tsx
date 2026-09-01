"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, Button, Card } from "@/components/ui";
import { isOfficePreviewable } from "@/modules/documents/constants";
import {
  createSelectedPassage,
  type SelectedPassage,
} from "@/modules/documents/preview-selection";

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
  onPassageSelected,
}: {
  documentId: string;
  mimeType: string;
  title: string;
  onPassageSelected?: (passage: SelectedPassage) => void;
}) {
  const [mode, setMode] = useState<"closed" | "visual" | "text">("closed");
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
    setMode("visual");
    if (office && html === null) void load();
  }

  if (mode === "closed") {
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
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={show}>Show preview</Button>
          {mimeType === "application/pdf" && onPassageSelected ? (
            <Button variant="ghost" onClick={() => setMode("text")}>Select a passage</Button>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Preview
        </h2>
        <div className="flex flex-wrap gap-2">
          {mimeType === "application/pdf" && onPassageSelected ? (
            <Button variant="ghost" onClick={() => setMode(mode === "text" ? "visual" : "text")}>
              {mode === "text" ? "Visual preview" : "Select a passage"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setMode("closed")}>Hide</Button>
        </div>
      </div>

      {mode === "text" && mimeType === "application/pdf" ? (
        <SelectablePdfText documentId={documentId} onPassageSelected={onPassageSelected} />
      ) : mimeType.startsWith("image/") ? (
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

type PreviewResponse = {
  pages?: { pageNumber: number; text: string }[];
  error?: string;
};

function SelectablePdfText({
  documentId,
  onPassageSelected,
}: {
  documentId: string;
  onPassageSelected?: (passage: SelectedPassage) => void;
}) {
  const [response, setResponse] = useState<PreviewResponse | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/documents/${documentId}/preview-text`, { signal: controller.signal })
      .then(async (result) => {
        const body = (await result.json()) as PreviewResponse;
        if (!result.ok) throw new Error(body.error || "Could not load preview.");
        setResponse(body);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setResponse({ error: cause instanceof Error ? cause.message : "Could not load preview." });
        }
      });
    return () => controller.abort();
  }, [documentId]);

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return;
    const anchor = selection.anchorNode.nodeType === Node.ELEMENT_NODE
      ? (selection.anchorNode as Element)
      : selection.anchorNode.parentElement;
    const focus = selection.focusNode.nodeType === Node.ELEMENT_NODE
      ? (selection.focusNode as Element)
      : selection.focusNode.parentElement;
    const anchorPage = anchor?.closest<HTMLElement>("[data-pdf-page]");
    const focusPage = focus?.closest<HTMLElement>("[data-pdf-page]");
    if (!anchorPage || anchorPage !== focusPage) {
      setSelectionMessage("Select text within one page at a time.");
      return;
    }
    const passage = createSelectedPassage(Number(anchorPage.dataset.pdfPage), selection.toString());
    if (!passage || !onPassageSelected) return;
    onPassageSelected(passage);
    setSelectionMessage(`Page ${passage.pageNumber} was added to the comment form below.`);
  }

  if (!response) return <div className="p-5 text-sm text-neutral-500 dark:text-neutral-400">Preparing selectable text…</div>;
  if (response.error) return <div className="p-5"><Alert tone="error">{response.error}</Alert></div>;
  if (!response.pages?.length) {
    return <div className="p-5"><Alert tone="warning">This PDF has no selectable text. It may be a scan and need OCR.</Alert></div>;
  }

  return (
    <div>
      <div className="border-b border-neutral-200 px-5 py-3 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        Drag across text on one page. The passage and page number will be added to the comment form.
        {selectionMessage ? <p className="mt-1 font-medium text-blue-700 dark:text-blue-300" aria-live="polite">{selectionMessage}</p> : null}
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto bg-neutral-100 p-4 dark:bg-neutral-950" onMouseUp={captureSelection} onKeyUp={captureSelection}>
        {response.pages.map((page) => (
          <article key={page.pageNumber} data-pdf-page={page.pageNumber} className="mx-auto max-w-4xl bg-white p-6 shadow-sm dark:bg-neutral-900">
            <p className="mb-4 text-xs font-medium text-neutral-400">Page {page.pageNumber}</p>
            <p className="whitespace-pre-wrap text-sm leading-7 text-neutral-900 dark:text-neutral-100">{page.text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
