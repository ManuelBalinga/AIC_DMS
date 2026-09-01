export const MAX_SELECTED_PASSAGE_LENGTH = 1000;

export type SelectedPassage = {
  pageNumber: number;
  quotedText: string;
};

/** Turn a browser selection into the durable anchor stored with a comment. */
export function createSelectedPassage(
  pageNumber: number,
  selectedText: string,
): SelectedPassage | null {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;

  const quotedText = selectedText.replace(/\s+/g, " ").trim();
  if (!quotedText) return null;

  return {
    pageNumber,
    quotedText: quotedText.slice(0, MAX_SELECTED_PASSAGE_LENGTH).trimEnd(),
  };
}
