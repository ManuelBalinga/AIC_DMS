import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normaliseSuggestedTags } from "@/modules/intelligence/summarise";
import { MAX_SUGGESTED_TAGS } from "@/modules/intelligence/config";
import { MAX_TAG_LENGTH, parseTags } from "@/modules/documents/constants";

/**
 * Tag-suggestion tests (master plan Phase 4, "automatic document tagging").
 *
 * This is the seam where a model's free text meets a database column, so it
 * gets the cases models actually produce — numbered lists, quotes, preambles —
 * rather than only the clean output the prompt asks for.
 */

describe("normaliseSuggestedTags", () => {
  test("splits a clean comma-separated list", () => {
    assert.deepEqual(normaliseSuggestedTags("fee schedule, i363, training"), [
      "fee schedule",
      "i363",
      "training",
    ]);
  });

  test("handles a newline-separated list", () => {
    assert.deepEqual(normaliseSuggestedTags("policy\nonboarding"), [
      "policy",
      "onboarding",
    ]);
  });

  test("strips list markers a model adds despite instructions", () => {
    assert.deepEqual(normaliseSuggestedTags("- policy\n- onboarding"), [
      "policy",
      "onboarding",
    ]);
    assert.deepEqual(normaliseSuggestedTags("1. policy\n2. onboarding"), [
      "policy",
      "onboarding",
    ]);
    assert.deepEqual(normaliseSuggestedTags("* policy, * onboarding"), [
      "policy",
      "onboarding",
    ]);
  });

  test("strips quotes around tags", () => {
    assert.deepEqual(normaliseSuggestedTags(`"policy", 'onboarding'`), [
      "policy",
      "onboarding",
    ]);
  });

  test("lower-cases and collapses whitespace", () => {
    assert.deepEqual(normaliseSuggestedTags("Fee   Schedule, TRAINING"), [
      "fee schedule",
      "training",
    ]);
  });

  test("de-duplicates within one suggestion list", () => {
    assert.deepEqual(normaliseSuggestedTags("policy, Policy, POLICY"), ["policy"]);
  });

  test("omits tags the document already carries", () => {
    // Suggesting what is already filed is noise, and ticking it would be a
    // no-op the person cannot distinguish from a real change.
    assert.deepEqual(
      normaliseSuggestedTags("policy, training, i363", ["policy", "i363"]),
      ["training"],
    );
  });

  test("matches existing tags case-insensitively", () => {
    assert.deepEqual(normaliseSuggestedTags("Policy", ["policy"]), []);
  });

  test("caps the number of suggestions", () => {
    const many = Array.from({ length: MAX_SUGGESTED_TAGS + 10 }, (_, i) => `t${i}`);
    assert.equal(normaliseSuggestedTags(many.join(",")).length, MAX_SUGGESTED_TAGS);
  });

  test("bounds tag length to what the column accepts", () => {
    const [tag] = normaliseSuggestedTags("x".repeat(MAX_TAG_LENGTH * 4));
    assert.ok(tag.length <= MAX_TAG_LENGTH);
  });

  test("returns an empty list for empty or junk-only output", () => {
    assert.deepEqual(normaliseSuggestedTags(""), []);
    assert.deepEqual(normaliseSuggestedTags("   \n  , , "), []);
    assert.deepEqual(normaliseSuggestedTags("- \n * \n 1. "), []);
  });

  test("produces tags a person could equally have typed", () => {
    // A suggestion that survives acceptance must be identical to the same tag
    // entered by hand, or the same shelf would split in the dashboard filter.
    for (const suggestion of normaliseSuggestedTags("Fee Schedule, i363, Training")) {
      assert.deepEqual(parseTags(suggestion), [suggestion]);
    }
  });
});
