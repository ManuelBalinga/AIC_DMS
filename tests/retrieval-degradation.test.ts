import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const retrieve = readFileSync("src/modules/rag/retrieve.ts", "utf8");
const askRoute = readFileSync("src/app/api/rag/ask/route.ts", "utf8");

function ordered(source: string, fragments: string[]) {
  let cursor = 0;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor);
    assert.notEqual(next, -1, "missing ordered fragment: " + fragment);
    cursor = next + fragment.length;
  }
}

/**
 * Retrieval has two ways of losing semantic search, and only one of them used
 * to be handled.
 *
 * A missing key was covered from the start. A *configured* provider that fails
 * at request time was not, so on 1 September a free-tier per-minute quota on
 * Gemini turned every question into an error page — even though the keyword arm
 * was working and would have answered. The gap is easy to reintroduce, because
 * the happy path reads perfectly well without a `try`, so these tests pin the
 * shape rather than the behaviour.
 */
describe("retrieval degrades instead of failing", () => {
  test("an embedding provider that throws falls back to keyword search", () => {
    ordered(retrieve, [
      "try {",
      "await embedQuery(trimmed)",
      "} catch {",
      "addKeywordHits()",
      'degradedTo: "keyword"',
    ]);
  });

  test("the unconfigured-provider path still degrades the same way", () => {
    ordered(retrieve, [
      "if (!embeddingsConfigured())",
      "addKeywordHits()",
      'degradedTo: "keyword"',
    ]);
  });

  test("embedQuery is never called outside a guard", () => {
    // One call site, one guard. A second unguarded call would restore exactly
    // the failure this file exists to prevent.
    const calls = retrieve.split("await embedQuery(").length - 1;
    assert.equal(calls, 1, "expected exactly one embedQuery call site");

    const guardIndex = retrieve.indexOf("try {");
    const callIndex = retrieve.indexOf("await embedQuery(");
    assert.ok(
      guardIndex !== -1 && guardIndex < callIndex,
      "embedQuery must sit inside the try block, not before it",
    );
  });

  test("the reader is told when an answer came from keywords alone", () => {
    // Degrading quietly would be worse than failing: the answer looks normal
    // but was drawn from a weaker search. The notice is what keeps the drop in
    // quality visible rather than silent.
    ordered(askRoute, [
      'degradedTo === "keyword"',
      '"notice"',
      "Semantic search is unavailable",
    ]);
  });

  test("the stored turn records which retrieval actually ran", () => {
    ordered(askRoute, [
      "retrievalMode:",
      'degradedTo === "keyword" ? "keyword" : "hybrid"',
    ]);
  });
});
