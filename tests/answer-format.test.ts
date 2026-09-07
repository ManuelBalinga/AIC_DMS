import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { stripInlineMarkdown, toBlocks } from "@/modules/rag/answer-format";

/**
 * Normalising an answer before it reaches the page.
 *
 * The renderer interprets exactly one convention — `[n]` citations — and prints
 * everything else literally. That is the right call and it means any markdown
 * the model reaches for out of habit lands on the page as punctuation. The
 * system prompt now asks for plain prose, which reduces the problem without
 * removing it; these tests cover the half that does not depend on the model
 * cooperating.
 *
 * The rule that must never break: citations survive. Everything here strips
 * characters near them, and a regex that eats a bracket turns a working link
 * into bare text.
 */

describe("stripping inline markdown", () => {
  test("removes bold and keeps the words", () => {
    assert.equal(stripInlineMarkdown("The **i363** fee rose."), "The i363 fee rose.");
    assert.equal(stripInlineMarkdown("The __i363__ fee rose."), "The i363 fee rose.");
  });

  test("removes italics without eating mid-word underscores or asterisks", () => {
    assert.equal(stripInlineMarkdown("The *i363* fee."), "The i363 fee.");
    // A file name is not emphasis. Eating this would corrupt a real value.
    assert.equal(stripInlineMarkdown("See fees_2026_final.xlsx"), "See fees_2026_final.xlsx");
  });

  test("removes backticks, strikethrough and headings", () => {
    assert.equal(stripInlineMarkdown("Run `npm test` now."), "Run npm test now.");
    assert.equal(stripInlineMarkdown("~~old~~ new"), "old new");
    assert.equal(stripInlineMarkdown("## Summary"), "Summary");
  });

  test("removes blockquote markers and horizontal rules", () => {
    assert.equal(stripInlineMarkdown("> quoted line"), "quoted line");
    assert.equal(stripInlineMarkdown("---").trim(), "");
  });

  test("LEAVES CITATIONS ALONE", () => {
    // The one thing the renderer does interpret.
    assert.equal(stripInlineMarkdown("The fee is 500 [2]."), "The fee is 500 [2].");
    assert.equal(stripInlineMarkdown("Both agree [1, 2]."), "Both agree [1, 2].");
    assert.equal(
      stripInlineMarkdown("The **fee** is `500` [1, 2]."),
      "The fee is 500 [1, 2].",
    );
  });
});

describe("splitting an answer into blocks", () => {
  test("plain prose is one paragraph", () => {
    const blocks = toBlocks("The i363 fee is 500 cedis [1].");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, "paragraph");
  });

  test("a run of bullets becomes one list, not several", () => {
    // The naive line-by-line pass produces four one-item lists, which renders
    // as a column of lonely dots.
    const blocks = toBlocks("Documents:\n* Alpha\n* Beta\n* Gamma");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].kind, "paragraph");
    assert.equal(blocks[1].kind, "list");
    assert.deepEqual(blocks[1].kind === "list" ? blocks[1].items : [], ["Alpha", "Beta", "Gamma"]);
  });

  test("dashes, plus signs and numbers all count as bullets", () => {
    for (const marker of ["-", "+", "•", "1.", "2)"]) {
      const blocks = toBlocks(`${marker} Alpha`);
      assert.equal(blocks[0].kind, "list", `${marker} was not treated as a bullet`);
    }
  });

  test("bullet markers do not survive into the item text", () => {
    const blocks = toBlocks("* Alpha\n- Beta");
    const items = blocks[0].kind === "list" ? blocks[0].items : [];
    for (const item of items) assert.doesNotMatch(item, /^[*+\-•]/);
  });

  test("citations inside a bullet survive", () => {
    const blocks = toBlocks("* The fee is 500 [1].");
    const items = blocks[0].kind === "list" ? blocks[0].items : [];
    assert.equal(items[0], "The fee is 500 [1].");
  });

  test("blank lines separate paragraphs", () => {
    const blocks = toBlocks("First point.\n\nSecond point.");
    assert.equal(blocks.length, 2);
    assert.equal(blocks.every((b) => b.kind === "paragraph"), true);
  });

  test("a paragraph after a list starts a new block", () => {
    const blocks = toBlocks("* Alpha\n* Beta\nThat is the whole list.");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].kind, "list");
    assert.equal(blocks[1].kind, "paragraph");
  });

  test("inline markdown is stripped inside list items too", () => {
    const blocks = toBlocks("* The **i363** fee");
    const items = blocks[0].kind === "list" ? blocks[0].items : [];
    assert.equal(items[0], "The i363 fee");
  });

  test("empty input produces no blocks rather than an empty paragraph", () => {
    assert.deepEqual(toBlocks(""), []);
    assert.deepEqual(toBlocks("\n\n  \n"), []);
  });

  test("the real shape the model produced before this fix", () => {
    // Verbatim from a probe against the live endpoint.
    const blocks = toBlocks(
      'You have access to 4 documents:\n* "Industry Internship Course Outline 2026"\n* "Fee schedule 2026"\n* "Staff handbook"\n* "Board minutes July"',
    );
    assert.equal(blocks.length, 2);
    assert.equal(blocks[1].kind, "list");
    assert.equal(blocks[1].kind === "list" ? blocks[1].items.length : 0, 4);
    // No asterisk reaches the page.
    for (const block of blocks) {
      const text = block.kind === "list" ? block.items.join(" ") : block.text;
      assert.doesNotMatch(text, /\*/);
    }
  });
});
