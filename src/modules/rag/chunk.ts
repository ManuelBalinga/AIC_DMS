import "server-only";

import {
  CHUNK_MIN_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNK_TARGET_CHARS,
} from "@/modules/rag/config";
import type { ExtractedPage } from "@/modules/rag/extract";

export type Chunk = {
  index: number;
  content: string;
  pageNumber: number | null;
  /** Rough token estimate; used for reporting, never for billing decisions. */
  tokenEstimate: number;
};

/**
 * Splits text on paragraph boundaries first, then sentence boundaries, and only
 * mid-sentence as a last resort.
 *
 * A retrieved passage that begins mid-clause reads as a broken quote in the
 * answer's citations, so respecting natural boundaries is a user-visible
 * quality decision rather than an implementation detail.
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  // Split after ., ! or ? followed by whitespace. Deliberately simple: a
  // heavier sentence tokeniser buys very little here, because the result is fed
  // straight back into a size-based packer.
  const pieces = text.match(/[^.!?\n]+[.!?]*\s*/g);
  return pieces ? pieces.map((piece) => piece.trim()).filter(Boolean) : [text];
}

function hardSplit(text: string, size: number): string[] {
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    pieces.push(text.slice(start, start + size));
  }
  return pieces;
}

/** Breaks one page's text into size-bounded units that respect boundaries. */
function toUnits(text: string): string[] {
  const units: string[] = [];

  for (const paragraph of splitParagraphs(text)) {
    if (paragraph.length <= CHUNK_TARGET_CHARS) {
      units.push(paragraph);
      continue;
    }

    for (const sentence of splitSentences(paragraph)) {
      if (sentence.length <= CHUNK_TARGET_CHARS) {
        units.push(sentence);
      } else {
        units.push(...hardSplit(sentence, CHUNK_TARGET_CHARS));
      }
    }
  }

  return units;
}

/** Tail of `text` to carry into the next chunk, cut at a word boundary. */
function overlapTail(text: string): string {
  if (CHUNK_OVERLAP_CHARS <= 0 || text.length <= CHUNK_OVERLAP_CHARS) return "";

  const tail = text.slice(-CHUNK_OVERLAP_CHARS);
  const boundary = tail.search(/\s/);
  return boundary === -1 ? tail : tail.slice(boundary + 1);
}

/**
 * Packs extracted pages into overlapping chunks.
 *
 * Chunks never span pages: a citation that claims to be from page 4 has to
 * actually be from page 4, and a chunk covering the seam between two pages
 * could not honestly claim either.
 */
export function chunkPages(pages: ExtractedPage[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;

  const push = (content: string, pageNumber: number | null) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    chunks.push({
      index: index++,
      content: trimmed,
      pageNumber,
      tokenEstimate: Math.ceil(trimmed.length / 4),
    });
  };

  for (const page of pages) {
    let buffer = "";

    for (const unit of toUnits(page.text)) {
      const candidate = buffer ? `${buffer}\n\n${unit}` : unit;

      if (candidate.length <= CHUNK_TARGET_CHARS) {
        buffer = candidate;
        continue;
      }

      if (buffer) {
        push(buffer, page.pageNumber);
        const tail = overlapTail(buffer);
        buffer = tail ? `${tail}\n\n${unit}` : unit;
      } else {
        // A single unit already exceeds the target; emit it on its own.
        push(unit, page.pageNumber);
        buffer = "";
      }
    }

    if (buffer) {
      const previous = chunks.at(-1);

      // A tiny trailing fragment is more useful appended to the chunk before it
      // than stored as a passage too short to answer anything.
      if (
        buffer.length < CHUNK_MIN_CHARS &&
        previous &&
        previous.pageNumber === page.pageNumber &&
        previous.content.length + buffer.length <= CHUNK_TARGET_CHARS * 1.5
      ) {
        previous.content = `${previous.content}\n\n${buffer.trim()}`;
        previous.tokenEstimate = Math.ceil(previous.content.length / 4);
      } else {
        push(buffer, page.pageNumber);
      }
    }
  }

  return chunks;
}
