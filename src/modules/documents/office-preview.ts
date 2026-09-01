import "server-only";

import { extractText } from "@/modules/rag/extract";

/**
 * Reading a Word, Excel or PowerPoint file without leaving the platform.
 *
 * The usual way to do this is to hand the file to Microsoft's or Google's
 * online viewer, which renders it faithfully and for free. That is not an
 * option here: it means shipping an AIC document to a third party on every
 * preview, which is the exact question Bishop has not yet answered and the
 * exact thing this platform exists to stop happening in WhatsApp. A viewer
 * that requires the document to leave is not a viewer for this product.
 *
 * So rendering happens on our own server, from parsers already in the project
 * for indexing. The trade is honest and worth stating: this is readable, not
 * faithful. A Word document keeps its headings, lists, tables and emphasis; a
 * spreadsheet becomes its cell values; a deck becomes its slide text. Layout,
 * theming, charts and images are lost. For "what does this say", which is what
 * someone opening a shared document usually wants, that is enough. For "does
 * this look right", Download still exists and is still the honest answer.
 */

export type OfficePreview =
  | { ok: true; kind: "html" | "text"; html: string }
  | { ok: false; reason: string };

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Formats this module can turn into something readable in the browser. */
const RENDERABLE = new Set([DOCX, XLSX, PPTX]);

export function hasOfficePreview(mimeType: string): boolean {
  return RENDERABLE.has(mimeType);
}

/* -------------------------------------------------------------------------- */
/* Sanitising                                                                 */
/* -------------------------------------------------------------------------- */

const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td",
  "a", "hr", "span", "div",
]);

/**
 * An allowlist, applied to converter output before it reaches a page.
 *
 * mammoth produces a small, semantic tag set and no scripts, so this is not
 * guarding against mammoth. It is guarding against the document: the HTML is
 * derived from a file any colleague can upload, and treating converter output
 * as trusted because the converter is trusted is how injection gets in. The
 * specific reachable attack without this is an `<a href="javascript:...">`
 * carried through from a hyperlink in the source document.
 *
 * Written rather than pulled in, to stay consistent with the project's habit
 * of not adding a dependency for something this size, and because an allowlist
 * of twenty tags is easier to audit than a sanitiser's configuration.
 */
function sanitiseHtml(html: string): string {
  return (
    html
      // Anything script-like goes wholesale, opening tag to closing tag.
      .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
      .replace(/<(script|style|iframe|object|embed|form)[^>]*\/?>/gi, "")
      // Then every remaining tag is checked against the allowlist, and its
      // attributes reduced to the two that are safe to keep.
      .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, rawName, rawAttrs) => {
        const name = String(rawName).toLowerCase();
        if (!ALLOWED_TAGS.has(name)) return "";
        if (match.startsWith("</")) return `</${name}>`;

        const attrs: string[] = [];
        if (name === "a") {
          const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(String(rawAttrs));
          const value = (href?.[2] ?? href?.[3] ?? "").trim();
          // http, https and mailto only. Everything else — javascript:, data:,
          // vbscript:, and any protocol-relative trick — is dropped rather
          // than rewritten, so a link that cannot be made safe simply is not
          // a link.
          if (/^(https?:|mailto:)/i.test(value)) {
            attrs.push(`href="${value.replace(/"/g, "&quot;")}"`);
            attrs.push('target="_blank"');
            attrs.push('rel="noopener noreferrer nofollow"');
          }
        }
        if (name === "th" || name === "td") {
          for (const span of ["colspan", "rowspan"]) {
            const found = new RegExp(`${span}\\s*=\\s*"(\\d{1,3})"`, "i").exec(String(rawAttrs));
            if (found) attrs.push(`${span}="${found[1]}"`);
          }
        }
        return `<${name}${attrs.length ? " " + attrs.join(" ") : ""}>`;
      })
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

export async function renderOfficePreview(
  buffer: Buffer,
  mimeType: string,
): Promise<OfficePreview> {
  if (!RENDERABLE.has(mimeType)) {
    return { ok: false, reason: "That format cannot be previewed here yet." };
  }

  try {
    if (mimeType === DOCX) {
      // convertToHtml rather than extractRawText, which is what indexing uses:
      // a person reading a document wants its headings, lists and tables, and
      // a wall of undifferentiated text is barely more readable than the
      // download it is meant to save.
      const mammoth = await import("mammoth");
      const { value } = await mammoth.convertToHtml({ buffer });
      const html = sanitiseHtml(value).trim();
      if (!html) return { ok: false, reason: "This document appears to be empty." };
      return { ok: true, kind: "html", html };
    }

    // Spreadsheets and decks go through the same reader indexing uses, so a
    // preview and an answer are drawn from exactly the same text. If Ask can
    // quote it, the preview shows it, and there is no second parser to drift.
    const result = await extractText(buffer, mimeType);
    if (!result.ok) return { ok: false, reason: result.reason };

    const label = mimeType === XLSX ? "Sheet" : "Slide";
    const sections = result.pages
      .filter((page) => page.text.trim())
      .map((page) => {
        const heading = page.pageNumber === null ? "" : `<h3>${label} ${page.pageNumber}</h3>`;
        return `${heading}<pre>${escapeHtml(page.text.trim())}</pre>`;
      });

    if (sections.length === 0) {
      return { ok: false, reason: "No readable text was found in this file." };
    }
    return { ok: true, kind: "text", html: sections.join("\n") };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, reason: `This file could not be read: ${message.slice(0, 200)}` };
  }
}

/** Exported for tests: the sanitiser is the part with a security consequence. */
export const __testing = { sanitiseHtml };
