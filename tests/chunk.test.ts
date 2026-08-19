import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { chunkPages } from "@/modules/rag/chunk";
import {
  CHUNK_MIN_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNK_TARGET_CHARS,
} from "@/modules/rag/config";
import type { ExtractedPage } from "@/modules/rag/extract";

/**
 * Chunking tests (master plan §15, "document parsing tests").
 *
 * Chunking is where a retrieval bug is least visible and most damaging: every
 * property asserted here is one a person would only notice as a citation that
 * quotes the wrong page, or an answer that cannot find text it should have.
 */

const page = (text: string, pageNumber: number | null = 1): ExtractedPage => ({
  text,
  pageNumber,
});

/** `count` words, so lengths are predictable but text still has boundaries. */
function words(count: number, token = "alpha"): string {
  return Array.from({ length: count }, () => token).join(" ");
}

function paragraphs(count: number, wordsEach: number): string {
  return Array.from({ length: count }, (_, i) => words(wordsEach, `p${i}word`)).join(
    "\n\n",
  );
}

describe("chunkPages", () => {
  test("returns nothing for empty or whitespace-only pages", () => {
    assert.deepEqual(chunkPages([]), []);
    assert.deepEqual(chunkPages([page("")]), []);
    assert.deepEqual(chunkPages([page("   \n\n  \t ")]), []);
  });

  test("keeps a short document as a single chunk", () => {
    const chunks = chunkPages([page("A short policy note about fees.")]);

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].content, "A short policy note about fees.");
    assert.equal(chunks[0].index, 0);
    assert.equal(chunks[0].pageNumber, 1);
  });

  test("indexes chunks contiguously from zero across pages", () => {
    const chunks = chunkPages([
      page(paragraphs(6, 200), 1),
      page(paragraphs(6, 200), 2),
    ]);

    assert.ok(chunks.length > 2, "expected the fixture to produce several chunks");
    assert.deepEqual(
      chunks.map((c) => c.index),
      chunks.map((_, i) => i),
    );
  });

  test("never lets a chunk span two pages", () => {
    // The citation contract: a passage attributed to page 4 must be from page 4.
    const marker1 = "PAGEONEMARKER";
    const marker2 = "PAGETWOMARKER";

    const chunks = chunkPages([
      page(`${marker1} ${words(50)}`, 1),
      page(`${marker2} ${words(50)}`, 2),
    ]);

    for (const chunk of chunks) {
      const hasFirst = chunk.content.includes(marker1);
      const hasSecond = chunk.content.includes(marker2);
      assert.ok(!(hasFirst && hasSecond), "a chunk mixed content from two pages");

      if (hasFirst) assert.equal(chunk.pageNumber, 1);
      if (hasSecond) assert.equal(chunk.pageNumber, 2);
    }
  });

  test("carries a null page number through for formats without pages", () => {
    const chunks = chunkPages([page("Some DOCX text with no page concept.", null)]);

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].pageNumber, null);
  });

  test("splits oversized text rather than emitting one giant chunk", () => {
    const chunks = chunkPages([page(paragraphs(20, 150))]);

    assert.ok(chunks.length > 1, "oversized page should split");
    // The packer emits a unit that alone exceeds the target, so allow a margin
    // rather than asserting a hard ceiling it was never designed to honour.
    for (const chunk of chunks) {
      assert.ok(
        chunk.content.length <= CHUNK_TARGET_CHARS * 1.5,
        `chunk of ${chunk.content.length} chars far exceeds the ${CHUNK_TARGET_CHARS} target`,
      );
    }
  });

  test("overlaps neighbouring chunks so text on a seam stays retrievable", () => {
    const chunks = chunkPages([page(paragraphs(20, 150))]);

    assert.ok(chunks.length > 1);

    // Some tail of chunk N should reappear at the head of chunk N+1; without it
    // a sentence straddling the boundary is findable from neither side.
    const [first, second] = chunks;
    const tail = first.content.slice(-CHUNK_OVERLAP_CHARS);
    const overlapWords = tail.split(/\s+/).filter((w) => w.length > 3);
    const reappears = overlapWords.some((word) => second.content.includes(word));

    assert.ok(reappears, "no overlap carried into the following chunk");
  });

  test("does not leave a tiny trailing fragment as its own chunk", () => {
    // A fragment below the minimum is appended to the previous chunk instead,
    // because a 40-character passage cannot answer anything on its own.
    const chunks = chunkPages([page(`${paragraphs(8, 150)}\n\nTiny tail.`)]);

    const last = chunks.at(-1)!;
    if (chunks.length > 1) {
      assert.ok(
        last.content.length >= CHUNK_MIN_CHARS,
        `trailing chunk of ${last.content.length} chars is below the ${CHUNK_MIN_CHARS} minimum`,
      );
    }
  });

  test("trims surrounding whitespace from every chunk", () => {
    const chunks = chunkPages([page("   Padded on both sides.   ")]);

    assert.equal(chunks[0].content, "Padded on both sides.");
    for (const chunk of chunks) {
      assert.equal(chunk.content, chunk.content.trim());
    }
  });

  test("estimates tokens from length rather than reporting zero", () => {
    const chunks = chunkPages([page(words(100))]);

    for (const chunk of chunks) {
      assert.ok(chunk.tokenEstimate > 0);
      assert.equal(chunk.tokenEstimate, Math.ceil(chunk.content.length / 4));
    }
  });

  test("skips blank pages without disturbing the index sequence", () => {
    const chunks = chunkPages([
      page("First page content.", 1),
      page("   ", 2),
      page("Third page content.", 3),
    ]);

    assert.deepEqual(
      chunks.map((c) => c.pageNumber),
      [1, 3],
    );
    assert.deepEqual(
      chunks.map((c) => c.index),
      [0, 1],
    );
  });
});
