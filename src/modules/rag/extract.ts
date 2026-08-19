import "server-only";

import { unzipSync } from "fflate";

/**
 * Text extraction, one strategy per format (plan §9 research question 2).
 *
 * Everything here works on a Buffer in memory and returns plain text split by
 * page where the format has a notion of one. No shelling out to external
 * binaries, so this runs unchanged on a serverless host.
 */

export type ExtractedPage = {
  /** 1-indexed, or null for formats without pages. */
  pageNumber: number | null;
  text: string;
};

export type ExtractionResult =
  | { ok: true; pages: ExtractedPage[] }
  | { ok: false; reason: string };

const decoder = new TextDecoder("utf-8");

/* -------------------------------------------------------------------------- */
/* OOXML (docx / xlsx / pptx) share a zip-of-XML container                    */
/* -------------------------------------------------------------------------- */

/** Strips XML tags, keeping the text nodes and inserting sensible whitespace. */
function xmlToText(xml: string): string {
  return xml
    // Paragraph, row and slide-line boundaries become newlines rather than
    // silently concatenating two unrelated sentences.
    .replace(/<\/(a:p|w:p|text:p|row)>/g, "\n")
    .replace(/<\/(c|w:tc|a:t|t)>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reads an OOXML package and returns text per matching entry.
 *
 * `entryPattern` picks the parts that hold user content — slides for pptx,
 * worksheets for xlsx — and ignores theme, style and relationship parts.
 */
function extractOoxmlParts(
  buffer: Buffer,
  entryPattern: RegExp,
): { name: string; text: string }[] {
  const files = unzipSync(new Uint8Array(buffer));

  return Object.keys(files)
    .filter((name) => entryPattern.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((name) => ({ name, text: xmlToText(decoder.decode(files[name])) }))
    .filter((part) => part.text.length > 0);
}

/**
 * Spreadsheet cell text lives in a shared string table, referenced by index
 * from each sheet. Resolving it is what turns `<v>7</v>` back into a word.
 */
function extractXlsx(buffer: Buffer): ExtractedPage[] {
  const files = unzipSync(new Uint8Array(buffer));

  const sharedStrings: string[] = [];
  const sharedXml = files["xl/sharedStrings.xml"];
  if (sharedXml) {
    const xml = decoder.decode(sharedXml);
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      sharedStrings.push(xmlToText(match[1]).replace(/\n/g, " ").trim());
    }
  }

  const pages: ExtractedPage[] = [];

  const sheetNames = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  for (const [index, name] of sheetNames.entries()) {
    const xml = decoder.decode(files[name]);
    const rows: string[] = [];

    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];

      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1];
        const body = cellMatch[2];
        const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);

        if (/t="s"/.test(attrs) && valueMatch) {
          cells.push(sharedStrings[Number(valueMatch[1])] ?? "");
        } else if (/t="inlineStr"/.test(attrs)) {
          cells.push(xmlToText(body).replace(/\n/g, " ").trim());
        } else if (valueMatch) {
          cells.push(valueMatch[1]);
        }
      }

      const row = cells.filter(Boolean).join(" | ");
      if (row) rows.push(row);
    }

    if (rows.length > 0) {
      pages.push({ pageNumber: index + 1, text: rows.join("\n") });
    }
  }

  return pages;
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Formats accepted for upload but not indexed, with the reason.
 *
 * Images need OCR, which is an unresolved research question (plan §9) and needs
 * real AIC samples before a tool is chosen. Legacy binary Office formats are a
 * different container entirely from OOXML.
 */
export const UNINDEXABLE_MIME_TYPES: Record<string, string> = {
  "image/png": "Images need OCR, which the beta does not do yet.",
  "image/jpeg": "Images need OCR, which the beta does not do yet.",
  "application/msword": "Legacy .doc is not supported — re-save as .docx.",
  "application/vnd.ms-excel": "Legacy .xls is not supported — re-save as .xlsx.",
  "application/vnd.ms-powerpoint":
    "Legacy .ppt is not supported — re-save as .pptx.",
};

export function isIndexableMimeType(mimeType: string): boolean {
  return !(mimeType in UNINDEXABLE_MIME_TYPES);
}

export async function extractText(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractionResult> {
  const unindexable = UNINDEXABLE_MIME_TYPES[mimeType];
  if (unindexable) return { ok: false, reason: unindexable };

  try {
    switch (mimeType) {
      case "application/pdf": {
        // Imported lazily: unpdf pulls in a large pdf.js build, and most
        // requests to this app never touch a PDF.
        const { extractText: extractPdfText } = await import("unpdf");
        const { text } = await extractPdfText(new Uint8Array(buffer), {
          mergePages: false,
        });

        return {
          ok: true,
          pages: text
            .map((pageText, index) => ({
              pageNumber: index + 1,
              text: pageText.replace(/[ \t]{2,}/g, " ").trim(),
            }))
            .filter((page) => page.text.length > 0),
        };
      }

      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.extractRawText({ buffer });
        const text = value.replace(/\n{3,}/g, "\n\n").trim();
        return { ok: true, pages: text ? [{ pageNumber: null, text }] : [] };
      }

      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return { ok: true, pages: extractXlsx(buffer) };

      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return {
          ok: true,
          pages: extractOoxmlParts(buffer, /^ppt\/slides\/slide\d+\.xml$/).map(
            (part, index) => ({ pageNumber: index + 1, text: part.text }),
          ),
        };

      case "text/plain":
      case "text/markdown":
      case "text/csv": {
        const text = buffer.toString("utf8").replace(/\r\n/g, "\n").trim();
        return { ok: true, pages: text ? [{ pageNumber: null, text }] : [] };
      }

      default:
        return { ok: false, reason: `No parser for ${mimeType}.` };
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, reason: `Could not read the file: ${detail}` };
  }
}
