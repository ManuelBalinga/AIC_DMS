/**
 * Formats accepted by the beta.
 *
 * Open question for Bishop (plan 15.2): confirm the exact document types AIC
 * actually circulates today. This list covers the stated cases -- product docs,
 * updates, i363 materials -- and is the same list the Week 2 parser must handle.
 */
export const ACCEPTED_MIME_TYPES = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
} as const;

export const ACCEPT_ATTRIBUTE = Object.values(ACCEPTED_MIME_TYPES).join(",");

/** Mirrors the bucket limit set in migration 0002. */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const STORAGE_BUCKET = "documents";

export function isAcceptedMimeType(mimeType: string): boolean {
  return mimeType in ACCEPTED_MIME_TYPES;
}

/**
 * Formats a browser renders natively, so the preview can be an iframe.
 *
 * Lives here rather than beside the preview component because a server
 * component has to ask the question before deciding whether to render that
 * component at all. Exporting it from a "use client" module made the document
 * page throw at runtime — a server module cannot call into a client one, and
 * the failure surfaced as the whole page erroring rather than as a missing
 * preview.
 */
const NATIVELY_PREVIEWABLE_PREFIXES = ["image/", "text/"];
const NATIVELY_PREVIEWABLE_TYPES = ["application/pdf"];

/**
 * Formats converted on our own server into readable HTML, because a browser
 * cannot open them and the alternative — a third-party online viewer — would
 * send an AIC document out of AIC's control on every preview.
 *
 * The legacy binary formats (.doc, .xls, .ppt) are deliberately absent. They
 * are a different container from OOXML entirely, no parser here reads them,
 * and indexing already refuses them for the same reason.
 */
const OFFICE_PREVIEWABLE_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export function isOfficePreviewable(mimeType: string): boolean {
  return OFFICE_PREVIEWABLE_TYPES.includes(mimeType);
}

export function isNativelyPreviewable(mimeType: string): boolean {
  return (
    NATIVELY_PREVIEWABLE_TYPES.includes(mimeType) ||
    NATIVELY_PREVIEWABLE_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  );
}

export function isPreviewable(mimeType: string): boolean {
  return isNativelyPreviewable(mimeType) || isOfficePreviewable(mimeType);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Strips path separators and exotic characters from an uploaded file name. */
export function sanitiseFileName(fileName: string): string {
  return (
    fileName
      .replace(/[\\/]/g, "-")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(-120) || "document"
  );
}

/** Longest tag the UI will accept, and the most any one document may carry. */
export const MAX_TAG_LENGTH = 32;
export const MAX_TAGS_PER_DOCUMENT = 12;

/**
 * Turns a free-text tag field into a clean, de-duplicated tag list.
 *
 * Lower-cased so "Product" and "product" are the same tag rather than two
 * entries that split the same shelf in the dashboard filter.
 */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();

  for (const piece of raw.split(/[,\n]/)) {
    const tag = piece
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, MAX_TAG_LENGTH);

    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS_PER_DOCUMENT) break;
  }

  return [...seen];
}

/** Human-facing wording for the RAG ingestion lifecycle. */
export const INDEX_STATUS_LABELS = {
  pending: "Waiting to be indexed",
  processing: "Indexing",
  indexed: "Searchable by AI",
  failed: "Indexing failed",
} as const;
