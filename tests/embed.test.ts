import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { getEmbeddingProvider, embeddingsConfigured, embedAll } from "@/modules/rag/embed";
import { EMBEDDING_DIMENSIONS } from "@/modules/rag/config";

/**
 * Embedding provider resolution.
 *
 * These tests exist because the provider is chosen entirely from environment
 * variables, which means a typo in a variable name degrades AI search silently
 * rather than failing loudly — `getEmbeddingProvider` returning null is a
 * legitimate state, so nothing downstream can tell "deliberately off" from
 * "misconfigured". Pinning the resolution rules is the only place that
 * distinction can be checked.
 *
 * Nothing here reaches the network. `fetch` is stubbed where a request matters,
 * so the suite still runs with no keys, no Ollama and no connection.
 */

const EMBEDDING_ENV = [
  "EMBEDDING_PROVIDER",
  "EMBEDDING_MODEL",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_API_KEY",
  "EMBEDDING_OMIT_DIMENSIONS",
  "OPENAI_API_KEY",
] as const;

let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

beforeEach(() => {
  saved = {};
  for (const key of EMBEDDING_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of EMBEDDING_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  globalThis.fetch = realFetch;
});

/** A fetch stub returning one vector of `width` floats per input. */
function stubFetch(width: number, capture?: { url?: string; body?: unknown; headers?: unknown }) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (capture) {
      capture.url = String(url);
      capture.body = JSON.parse(String(init?.body ?? "{}"));
      capture.headers = init?.headers;
    }
    const inputs = JSON.parse(String(init?.body ?? "{}")).input as string[];
    return new Response(
      JSON.stringify({
        data: inputs.map((_, index) => ({ index, embedding: Array(width).fill(0.1) })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("embedding provider resolution", () => {
  test("defaults to openai, and is off when no key is set", () => {
    assert.equal(getEmbeddingProvider(), null);
    assert.equal(embeddingsConfigured(), false);
  });

  test("openai turns on as soon as a key exists", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const provider = getEmbeddingProvider();
    assert.equal(provider?.id, "openai");
    assert.equal(provider?.model, "text-embedding-3-small");
  });

  test("ollama needs no key at all", () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    const provider = getEmbeddingProvider();
    assert.equal(provider?.id, "ollama");
    assert.equal(provider?.model, "qwen3-embedding:4b");
  });

  test("openai-compatible is off until it has both a base URL and a model", () => {
    process.env.EMBEDDING_PROVIDER = "openai-compatible";
    assert.equal(getEmbeddingProvider(), null, "neither supplied");

    process.env.EMBEDDING_BASE_URL = "https://example.test/v1";
    assert.equal(getEmbeddingProvider(), null, "model still missing");

    process.env.EMBEDDING_MODEL = "some-embedding-model";
    assert.equal(getEmbeddingProvider()?.id, "openai-compatible");
  });

  test("an unrecognised provider reads as off rather than throwing", () => {
    process.env.EMBEDDING_PROVIDER = "not-a-provider";
    assert.equal(getEmbeddingProvider(), null);
  });
});

describe("embedding requests", () => {
  test("asks for the width the schema commits to", async () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    const capture: { url?: string; body?: unknown } = {};
    stubFetch(EMBEDDING_DIMENSIONS, capture);

    await embedAll(["hello"]);

    assert.equal(capture.url, "http://127.0.0.1:11434/v1/embeddings");
    assert.equal(
      (capture.body as { dimensions?: number }).dimensions,
      EMBEDDING_DIMENSIONS,
      "the dimensions parameter is how a Matryoshka model is held to 1536",
    );
  });

  test("EMBEDDING_OMIT_DIMENSIONS drops the parameter for providers that reject it", async () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    process.env.EMBEDDING_OMIT_DIMENSIONS = "true";
    const capture: { body?: unknown } = {};
    stubFetch(EMBEDDING_DIMENSIONS, capture);

    await embedAll(["hello"]);
    assert.ok(!("dimensions" in (capture.body as object)));
  });

  test("a trailing slash on the base URL does not become a double slash", async () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    process.env.EMBEDDING_BASE_URL = "http://127.0.0.1:11434/v1/";
    const capture: { url?: string } = {};
    stubFetch(EMBEDDING_DIMENSIONS, capture);

    await embedAll(["hello"]);
    assert.equal(capture.url, "http://127.0.0.1:11434/v1/embeddings");
  });

  test("no authorization header is sent when there is no key", async () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    const capture: { headers?: unknown } = {};
    stubFetch(EMBEDDING_DIMENSIONS, capture);

    await embedAll(["hello"]);
    assert.ok(!("authorization" in (capture.headers as Record<string, string>)));
  });

  test("vectors are returned in input order even when the response is shuffled", async () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.2) },
            { index: 0, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1) },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;

    const [first, second] = await embedAll(["a", "b"]);
    assert.equal(first[0], 0.1);
    assert.equal(second[0], 0.2);
  });

  test("a wrong width is refused, and the error says how to fix it", async () => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    stubFetch(768);

    await assert.rejects(
      () => embedAll(["hello"]),
      (error: Error) => {
        assert.match(error.message, /768/);
        assert.match(error.message, new RegExp(String(EMBEDDING_DIMENSIONS)));
        assert.match(error.message, /nomic-embed-text/);
        assert.match(error.message, /dimensions|migrate/i);
        return true;
      },
      "a short vector must fail loudly — pgvector would reject it later and less clearly",
    );
  });

  test("an unconfigured provider explains what to set", async () => {
    await assert.rejects(() => embedAll(["hello"]), /EMBEDDING_PROVIDER/);
  });
});
