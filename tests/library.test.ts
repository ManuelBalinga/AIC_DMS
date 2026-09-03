import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { formatLibrary, type Library } from "@/modules/rag/library-format";

/**
 * The catalogue block.
 *
 * `getLibrary` itself needs a database and belongs to the RLS suite — what is
 * testable here is the text handed to the model, which is where the failures
 * with consequences live. Two in particular: telling the model a capped list is
 * complete would make it state a confident wrong total, and bracketing a
 * catalogue entry would render a footnote the interface cannot turn into a
 * link, because its citation regex only matches digits.
 */

const doc = (over: Partial<Library["documents"][number]> = {}) => ({
  title: "Fee schedule 2026",
  fileName: "fees_2026.xlsx",
  tags: ["finance"],
  summary: "Programme fees for 2026.",
  uploadedAt: "2026-08-30T10:00:00.000Z",
  indexed: true,
  ...over,
});

const library = (over: Partial<Library> = {}): Library => ({
  total: 1,
  indexed: 1,
  awaitingIndex: 0,
  documents: [doc()],
  truncated: false,
  ...over,
});

describe("the catalogue handed to the model", () => {
  test("an empty library says so, rather than rendering an empty list", () => {
    const text = formatLibrary(library({ total: 0, indexed: 0, documents: [] }));
    assert.match(text, /no documents/i);
  });

  test("a complete list is declared countable", () => {
    const text = formatLibrary(library());
    assert.match(text, /safe to count/i);
    assert.doesNotMatch(text, /do not state a total/i);
  });

  test("a capped list forbids stating a total", () => {
    // The failure this prevents: the model counts 60 entries, says "we have 60
    // documents", and is wrong in a way nobody can see from the answer.
    const text = formatLibrary(library({ truncated: true, total: 60 }));
    assert.match(text, /do not state a total/i);
    assert.doesNotMatch(text, /safe to count/i);
  });

  test("documents still being indexed are flagged as not yet quotable", () => {
    const text = formatLibrary(
      library({
        total: 2,
        indexed: 1,
        awaitingIndex: 1,
        documents: [doc(), doc({ title: "Board minutes", indexed: false })],
      }),
    );
    assert.match(text, /still being processed/i);
    assert.match(text, /not yet indexed/i);
  });

  test("no entry is wrapped in square brackets", () => {
    // ask-panel.tsx matches /^\[(\d+(?:,\s*\d+)*)\]$/ — anything bracketed that
    // is not a passage number renders to the reader as a broken citation.
    const text = formatLibrary(
      library({ total: 2, indexed: 2, documents: [doc(), doc({ title: "Staff handbook" })] }),
    );
    assert.doesNotMatch(text, /\[[^\]]*\]/);
  });

  test("titles, dates and tags all reach the model", () => {
    const text = formatLibrary(library());
    assert.match(text, /Fee schedule 2026/);
    assert.match(text, /fees_2026\.xlsx/);
    assert.match(text, /2026-08-30/);
    assert.match(text, /finance/);
  });

  test("a document with no summary still lists cleanly", () => {
    const text = formatLibrary(library({ documents: [doc({ summary: null })] }));
    assert.match(text, /Fee schedule 2026/);
    assert.doesNotMatch(text, /null|undefined/);
  });

  test("a document with no tags omits the tag segment rather than printing an empty one", () => {
    const text = formatLibrary(library({ documents: [doc({ tags: [] })] }));
    assert.doesNotMatch(text, /tags:\s*(·|$)/m);
  });
});
