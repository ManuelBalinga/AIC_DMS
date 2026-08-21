import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildContextHeader, embeddableText } from "@/modules/rag/contextualise";
import {
  CONTEXT_HEADER_MAX_CHARS,
  CONTEXT_SUMMARY_MAX_CHARS,
  CONTEXTUAL_EMBEDDINGS,
} from "@/modules/rag/config";

/**
 * Contextual embedding tests.
 *
 * The property that matters most is the negative one: the header must never
 * reach `content`. A header that leaked into the stored passage would be quoted
 * back to a reader as though the document had said it, and a citation that
 * quotes text the document does not contain is worse than no citation.
 */

const context = {
  title: "2026 i363 Fee Schedule",
  tags: ["i363", "fees"],
  summary: "Sets the participant fees for the 2026 i363 programme.",
};

describe("buildContextHeader", () => {
  test("names the document, its tags and its page", () => {
    const header = buildContextHeader(context, { pageNumber: 4 });

    assert.ok(header);
    assert.match(header, /2026 i363 Fee Schedule/);
    assert.match(header, /i363, fees/);
    assert.match(header, /participant fees/);
    assert.match(header, /page 4/);
  });

  test("omits the page line for a format with no pages", () => {
    const header = buildContextHeader(context, { pageNumber: null });

    assert.ok(header);
    assert.doesNotMatch(header, /page/i);
  });

  test("degrades to title and tags when there is no summary", () => {
    // The path taken when no ANTHROPIC_API_KEY is set. Indexing must still work
    // and must still situate the passage, just less richly.
    const header = buildContextHeader({ ...context, summary: null }, { pageNumber: 1 });

    assert.ok(header);
    assert.match(header, /2026 i363 Fee Schedule/);
    assert.doesNotMatch(header, /This document is about/);
  });

  test("returns null when there is nothing to say", () => {
    const header = buildContextHeader(
      { title: "   ", tags: [], summary: null },
      { pageNumber: null },
    );

    assert.equal(header, null);
  });

  test("stays within the header budget", () => {
    // Every character here is paid for on every chunk of the document, so the
    // ceiling is a cost control rather than a formatting preference.
    const header = buildContextHeader(
      {
        title: "T".repeat(400),
        tags: Array.from({ length: 40 }, (_, index) => `tag-${index}`),
        summary: "word ".repeat(500),
      },
      { pageNumber: 9 },
    );

    assert.ok(header);
    assert.ok(
      header.length <= CONTEXT_HEADER_MAX_CHARS,
      `header was ${header.length}, over the ${CONTEXT_HEADER_MAX_CHARS} budget`,
    );
  });

  test("truncates a long summary on a word boundary", () => {
    const header = buildContextHeader(
      { title: "Doc", tags: [], summary: "alpha ".repeat(400) },
      { pageNumber: null },
    );

    assert.ok(header);
    // A summary cut mid-word contributes a fragment token to every chunk of the
    // document, so the cut lands on a space.
    assert.doesNotMatch(header, /alph$/);
    assert.ok(header.length <= CONTEXT_HEADER_MAX_CHARS);
    assert.ok(CONTEXT_SUMMARY_MAX_CHARS < "alpha ".repeat(400).length);
  });

  test("respects the feature switch", () => {
    // Guards against the switch being read at import time and silently ignored.
    const header = buildContextHeader(context, { pageNumber: 1 });
    assert.equal(header === null, !CONTEXTUAL_EMBEDDINGS);
  });
});

describe("embeddableText", () => {
  test("puts the header before the passage", () => {
    const combined = embeddableText("The fee is GHS 500.", "Document: Fees");

    assert.ok(combined.startsWith("Document: Fees"));
    assert.ok(combined.endsWith("The fee is GHS 500."));
  });

  test("returns the passage untouched when there is no header", () => {
    assert.equal(embeddableText("The fee is GHS 500.", null), "The fee is GHS 500.");
  });

  test("never alters the passage text itself", () => {
    // This is the assertion protecting citations: whatever the header does, the
    // document's own words come through byte for byte.
    const content = "The fee is GHS 500.\n\nPayable before the first session.";
    const combined = embeddableText(content, "Document: Fees\nFrom page 2.");

    assert.ok(combined.includes(content));
  });
});
