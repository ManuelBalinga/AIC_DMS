import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getAnswerProvider,
  answeringConfigured,
  __testing,
} from "@/modules/rag/answer-provider";

/**
 * Answer provider resolution and SSE parsing.
 *
 * Two things are worth pinning here. The resolution rules, for the same reason
 * as `embed.test.ts` — a null provider is a legitimate "off" state, so a typo in
 * a variable name degrades Ask silently rather than failing. And the SSE parser,
 * because its one real bug only appears under conditions a manual test will
 * never reproduce: a network chunk boundary landing in the middle of a line.
 *
 * Nothing here reaches the network.
 */

const ANSWER_ENV = [
  "ANSWER_PROVIDER",
  "ANSWER_BASE_URL",
  "ANSWER_API_KEY",
  "ANSWER_MODEL",
  "ANTHROPIC_API_KEY",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ANSWER_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ANSWER_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** Builds a stream that delivers exactly the given chunks, boundaries included. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<string> {
  let out = "";
  for await (const text of __testing.parseSseDeltas(streamOf(chunks))) out += text;
  return out;
}

const frame = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

describe("answer provider resolution", () => {
  test("defaults to anthropic, and is off without a key", () => {
    assert.equal(getAnswerProvider(), null);
    assert.equal(answeringConfigured(), false);
  });

  test("anthropic turns on as soon as a key exists", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    assert.equal(getAnswerProvider()?.id, "anthropic");
  });

  test("openai-compatible is off until it has both a base URL and a model", () => {
    process.env.ANSWER_PROVIDER = "openai-compatible";
    assert.equal(getAnswerProvider(), null, "neither supplied");

    process.env.ANSWER_BASE_URL = "https://api.groq.com/openai/v1";
    assert.equal(getAnswerProvider(), null, "model still missing");

    process.env.ANSWER_MODEL = "llama-3.3-70b-versatile";
    const provider = getAnswerProvider();
    assert.equal(provider?.id, "openai-compatible");
    assert.equal(provider?.model, "llama-3.3-70b-versatile");
  });

  test("an ANTHROPIC_API_KEY does not accidentally satisfy another provider", () => {
    process.env.ANSWER_PROVIDER = "openai-compatible";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    assert.equal(getAnswerProvider(), null);
  });

  test("an unrecognised provider reads as off rather than throwing", () => {
    process.env.ANSWER_PROVIDER = "not-a-provider";
    assert.equal(getAnswerProvider(), null);
  });
});

describe("SSE delta parsing", () => {
  test("reads consecutive frames", async () => {
    assert.equal(await collect([frame("Hello"), frame(" world")]), "Hello world");
  });

  test("survives a chunk boundary mid-line", async () => {
    // The failure this guards: the JSON for " world" is split across two
    // network reads. Parsing each read independently drops or corrupts it.
    const whole = frame("Hello") + frame(" world");
    const cut = Math.floor(whole.length * 0.6);
    assert.equal(
      await collect([whole.slice(0, cut), whole.slice(cut)]),
      "Hello world",
    );
  });

  test("survives a boundary landing between every single character", async () => {
    const whole = frame("abc") + frame("def");
    assert.equal(await collect(whole.split("")), "abcdef");
  });

  test("stops at [DONE] and ignores anything after it", async () => {
    assert.equal(
      await collect([frame("kept"), "data: [DONE]\n", frame("dropped")]),
      "kept",
    );
  });

  test("skips a malformed frame rather than discarding the answer", async () => {
    assert.equal(
      await collect([frame("before"), "data: {not json\n", frame("after")]),
      "beforeafter",
    );
  });

  test("ignores comments, blank lines and keep-alives", async () => {
    assert.equal(
      await collect([": keep-alive\n", "\n", frame("text"), "\n"]),
      "text",
    );
  });

  test("treats a null delta as no text rather than as \"null\"", async () => {
    const nullFrame = `data: ${JSON.stringify({ choices: [{ delta: { content: null } }] })}\n`;
    assert.equal(await collect([nullFrame, frame("real")]), "real");
  });

  test("a frame with no choices does not throw", async () => {
    assert.equal(await collect(['data: {"choices":[]}\n', frame("ok")]), "ok");
  });
});
