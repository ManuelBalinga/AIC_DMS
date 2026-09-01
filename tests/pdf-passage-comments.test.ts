import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  createSelectedPassage,
  MAX_SELECTED_PASSAGE_LENGTH,
} from "@/modules/documents/preview-selection";

describe("PDF passage comment anchors", () => {
  test("stores a one-indexed page and normalized selected text", () => {
    assert.deepEqual(createSelectedPassage(3, "  Fees\n\t are  GHS 500.  "), {
      pageNumber: 3,
      quotedText: "Fees are GHS 500.",
    });
  });

  test("rejects an empty selection or invalid page", () => {
    assert.equal(createSelectedPassage(1, " \n\t "), null);
    assert.equal(createSelectedPassage(0, "A passage"), null);
    assert.equal(createSelectedPassage(1.5, "A passage"), null);
  });

  test("bounds text copied into a comment", () => {
    const passage = createSelectedPassage(
      1,
      "x".repeat(MAX_SELECTED_PASSAGE_LENGTH + 200),
    );

    assert.equal(passage?.quotedText.length, MAX_SELECTED_PASSAGE_LENGTH);
  });
});
