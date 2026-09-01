import "server-only";

export type PdfPreviewPage = {
  pageNumber: number;
  text: string;
};

/**
 * Extract selectable page text for the document review UI.
 *
 * This deliberately lives with documents rather than the RAG pipeline. The
 * preview is a reading feature and must not depend on indexing having run.
 */
export async function extractPdfPreviewText(
  buffer: Buffer,
): Promise<PdfPreviewPage[]> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(buffer), {
    mergePages: false,
  });

  return text
    .map((pageText, index) => ({
      pageNumber: index + 1,
      text: pageText
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    }))
    .filter((page) => page.text.length > 0);
}
