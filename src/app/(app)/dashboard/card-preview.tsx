"use client";

import { useEffect, useRef, useState } from "react";

import type { RenderTask } from "pdfjs-dist";
import type { PDFDocumentLoadingTask } from "pdfjs-dist/types/src/display/api";

import { isOfficePreviewable } from "@/modules/documents/constants";
import { stripInlineMarkdown } from "@/modules/rag/answer-format";

/**
 * The face of a card: what the file actually looks like, not a paraphrase.
 *
 * Google Drive made the expectation — a card shows the first page of the real
 * file — and this follows it, per format, using only machinery the platform
 * already trusts:
 *
 *   - Images are the bytes themselves, via the permission-checked inline
 *     route. An `<img>` rather than next/image because the source is a
 *     redirect to a 60-second signed URL, which the optimiser can neither
 *     cache nor re-fetch.
 *   - PDFs render their true first page to a canvas, in the browser, with the
 *     parser already in the project's dependency tree. No thumbnail store, no
 *     background job, no second set of permission rules: the page is drawn
 *     from the same bytes, behind the same grant, that Download hands over.
 *   - Word, Excel and PowerPoint reuse the on-server conversion the reading
 *     view uses, scaled down to card size. Readable, not pixel-faithful — the
 *     same honest trade the full-size preview already states.
 *   - Markdown and plain text stay words, but the markdown furniture the
 *     extractor carries through — asterisks, hash signs, quote chevrons — is
 *     stripped first. Nobody wants to read the plumbing.
 *
 * The heavy routes start only when a card is near the viewport, and every one
 * of them degrades to the opening text on failure, so a card is never empty
 * because a thumbnail could not be drawn.
 */

const INLINE_URL = (id: string) =>
  `/api/documents/${id}/download?disposition=inline`;

/** Markdown furniture an extractor carries into plain text. */
function cleanExtracted(text: string): string {
  return (
    stripInlineMarkdown(text)
      // Bullet markers, which stripInlineMarkdown leaves because answers
      // render their own lists; a card has no room to.
      .replace(/^\s{0,3}[*+\-•]\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function TextPane({
  body,
  status,
  markdown,
}: {
  body: string | null;
  status: string | null;
  markdown?: boolean;
}) {
  const text = body
    ? ((markdown ? cleanExtracted(body) : body) ?? "").slice(0, 320)
    : "";

  if (!text && !status) return null;

  return (
    <>
      {text ? (
        <p className="pr-12 text-[11px] leading-[1.65] text-ink-soft [overflow-wrap:anywhere]">
          {text}
        </p>
      ) : (
        <p className="pt-8 text-center text-[11.5px] text-ink-faint">
          {status}
        </p>
      )}
      {/* Fades the clipped text out rather than guillotining a line of it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-surface-sunk"
      />
    </>
  );
}

/**
 * Starts the work only when the card is close enough to be seen.
 *
 * Rendering pages and converting documents are not free, and a shelf of
 * twenty cards would pay for all of them to serve the three a reader looks
 * at. Once triggered the work never un-triggers — a card that scrolled past
 * and back would otherwise redraw and flicker.
 */
function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer support (very old browsers): start the work on the next
      // tick rather than synchronously, so the effect body stays a
      // subscription rather than a render trigger.
      const timer = setTimeout(() => setNear(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  return { ref, near };
}

/**
 * The visual sits on top of the text and covers it when it arrives, so a slow
 * thumbnail never leaves a card empty — the reader sees the opening words
 * until the page is drawn, and the real page after.
 */
function OverText({
  children,
  ready,
  failed,
  body,
  status,
  markdown,
}: {
  children: React.ReactNode;
  ready: boolean;
  failed: boolean;
  body: string | null;
  status: string | null;
  markdown?: boolean;
}) {
  return (
    <>
      {!failed ? (
        <div
          aria-hidden="true"
          className={`absolute inset-0 overflow-hidden bg-surface transition-opacity duration-200 ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        >
          {children}
        </div>
      ) : null}
      <div className={ready && !failed ? "invisible" : undefined}>
        <TextPane body={body} status={status} markdown={markdown} />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

function ImageThumb(props: {
  documentId: string;
  body: string | null;
  status: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <OverText ready={loaded} failed={failed} {...props}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={INLINE_URL(props.documentId)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
        className="absolute inset-0 h-full w-full object-cover object-top"
      />
    </OverText>
  );
}

/* -------------------------------------------------------------------------- */
/* PDFs                                                                       */
/* -------------------------------------------------------------------------- */

function PdfThumb(props: {
  documentId: string;
  body: string | null;
  status: string | null;
}) {
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let loading: PDFDocumentLoadingTask | null = null;

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const response = await fetch(INLINE_URL(props.documentId));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        if (cancelled) return;

        loading = pdfjs.getDocument({ data });
        const doc = await loading.promise;
        if (cancelled) return;

        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const base = page.getViewport({ scale: 1 });
        const width = canvas.parentElement?.clientWidth || 280;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({
          scale: (width / base.width) * dpr,
        });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        task = page.render({ canvas, viewport });
        await task.promise;
        if (cancelled) return;
        setReady(true);
      } catch {
        // A cancelled render is not a failure — it is this effect being torn
        // down, and the cleanup flag already knows that.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      void loading?.destroy();
    };
  }, [near, props.documentId]);

  return (
    <div ref={ref} className="absolute inset-0">
      <OverText ready={ready} failed={failed} {...props}>
        <canvas
          ref={canvasRef}
          className="block w-full bg-white"
        />
      </OverText>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Word, Excel, PowerPoint                                                    */
/* -------------------------------------------------------------------------- */

function OfficeThumb(props: {
  documentId: string;
  body: string | null;
  status: string | null;
}) {
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!near) return;
    const controller = new AbortController();
    void fetch(`/api/documents/${props.documentId}/preview`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          html?: string;
          error?: string;
        };
        if (!response.ok || !payload.html) {
          throw new Error(payload.error ?? "conversion failed");
        }
        // The converted HTML may carry hyperlinks, and a link inside the
        // card's own link is both invalid HTML and a click that would leave
        // the shelf. Unwrapping the tags keeps the words; the sanitiser has
        // already stripped everything unsafe about the attributes.
        setHtml(payload.html.replace(/<\/?a\b[^>]*>/gi, ""));
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [near, props.documentId]);

  return (
    <div ref={ref} className="absolute inset-0">
      <OverText ready={html !== null} failed={failed} {...props}>
        {/* The conversion is produced server-side behind an allowlist
            (modules/documents/office-preview.ts); the card merely scales it
            down. Origin top-left with a compensating width, so the document's
            own heading sits where a heading should. */}
        <div
          className="doc-card-preview absolute left-0 top-0 origin-top-left"
          style={{ width: "250%", transform: "scale(0.4)", padding: "12px 16px" }}
          dangerouslySetInnerHTML={{ __html: html ?? "" }}
        />
      </OverText>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function CardPreview({
  documentId,
  mimeType,
  body,
  status,
}: {
  documentId: string;
  mimeType: string;
  body: string | null;
  status: string | null;
}) {
  const markdown = mimeType === "text/markdown";

  if (mimeType.startsWith("image/")) {
    return <ImageThumb documentId={documentId} body={body} status={status} />;
  }
  if (mimeType === "application/pdf") {
    return <PdfThumb documentId={documentId} body={body} status={status} />;
  }
  if (isOfficePreviewable(mimeType)) {
    return <OfficeThumb documentId={documentId} body={body} status={status} />;
  }
  return <TextPane body={body} status={status} markdown={markdown} />;
}
