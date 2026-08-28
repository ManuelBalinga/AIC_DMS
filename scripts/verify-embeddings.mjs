#!/usr/bin/env node
/**
 * Proves the configured embedding provider before a single document is indexed.
 *
 * The failure this exists to catch does not look like a failure. `document_chunks.embedding`
 * is `vector(1536)`, fixed by migration 0001, and a provider that emits a
 * different width is not a slow path or a degraded mode — it is an ingestion
 * that throws on every document, or worse, a corpus embedded by one model and
 * queried by another. Vectors from different models are not comparable: they
 * place text in different coordinate spaces, so retrieval returns confident
 * nonsense rather than an error. Nothing downstream can detect it.
 *
 * So this asks the provider for one embedding and checks three things a person
 * cannot check by reading configuration: that the endpoint answers, that the
 * key is accepted, and that the vector is exactly the width the schema commits
 * to.
 *
 *   npm run verify:embeddings
 *
 * Reads .env.local the same way the other scripts do. Costs one embedding of
 * five words, which is free on every provider under discussion.
 */

import { readFileSync } from "node:fs";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local; fall through to whatever is already exported.
  }
}

loadEnv();

// Kept in step with src/modules/rag/config.ts by hand. If that constant ever
// changes, the column changed with it and every stored vector is already void,
// so a drifting copy here is the least of the problems.
const EMBEDDING_DIMENSIONS = 1536;

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

/**
 * Mirrors `getEmbeddingProvider` in src/modules/rag/embed.ts.
 *
 * Duplicated rather than imported because this is a plain node script and the
 * source is TypeScript behind a path alias. The duplication is deliberate and
 * small; the alternative is a build step for a diagnostic.
 */
function resolveProvider() {
  const provider = (process.env.EMBEDDING_PROVIDER ?? "openai").trim();
  const model = process.env.EMBEDDING_MODEL?.trim();

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return { error: "EMBEDDING_PROVIDER is openai but OPENAI_API_KEY is not set." };
    return {
      id: "openai",
      baseUrl: process.env.EMBEDDING_BASE_URL?.trim() || "https://api.openai.com/v1",
      apiKey,
      model: model || "text-embedding-3-small",
    };
  }

  if (provider === "ollama") {
    return {
      id: "ollama",
      baseUrl: process.env.EMBEDDING_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
      apiKey: process.env.EMBEDDING_API_KEY?.trim() || null,
      model: model || "qwen3-embedding:4b",
    };
  }

  if (provider === "openai-compatible") {
    const baseUrl = process.env.EMBEDDING_BASE_URL?.trim();
    if (!baseUrl) return { error: "EMBEDDING_PROVIDER is openai-compatible but EMBEDDING_BASE_URL is not set." };
    if (!model) return { error: "EMBEDDING_PROVIDER is openai-compatible but EMBEDDING_MODEL is not set." };
    return {
      id: "openai-compatible",
      baseUrl,
      apiKey:
        process.env.EMBEDDING_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim() ||
        null,
      model,
    };
  }

  return { error: `EMBEDDING_PROVIDER is "${provider}", which is not one of openai, ollama, openai-compatible.` };
}

/* -------------------------------------------------------------------------- */
/* The check                                                                  */
/* -------------------------------------------------------------------------- */

async function main() {
  const provider = resolveProvider();

  if (provider.error) {
    console.error(`\n  ${provider.error}`);
    console.error("  Embeddings are off: uploads will store but never index, and Ask falls back to keyword search.\n");
    return 1;
  }

  const sendDimensions = process.env.EMBEDDING_OMIT_DIMENSIONS?.trim() !== "true";
  const endpoint = `${provider.baseUrl.replace(/\/+$/, "")}/embeddings`;

  console.log("");
  console.log(`  provider    ${provider.id}`);
  console.log(`  endpoint    ${endpoint}`);
  console.log(`  model       ${provider.model}`);
  console.log(`  api key     ${provider.apiKey ? `set (${provider.apiKey.length} chars)` : "none — correct for a local Ollama, wrong for anything hosted"}`);
  console.log(`  dimensions  ${sendDimensions ? `requesting ${EMBEDDING_DIMENSIONS}` : "not requested (EMBEDDING_OMIT_DIMENSIONS=true)"}`);
  console.log("");

  const started = Date.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        input: ["the i363 fee schedule for the coming quarter"],
        ...(sendDimensions ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
      }),
    });
  } catch (cause) {
    console.error(`  FAILED  could not reach ${endpoint}`);
    console.error(`          ${cause instanceof Error ? cause.message : String(cause)}`);
    if (provider.id === "ollama") {
      console.error("          For a local Ollama, check it is running: ollama serve");
    }
    console.error("");
    return 1;
  }

  const elapsed = Date.now() - started;

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`  FAILED  HTTP ${response.status} from the provider`);
    if (detail) console.error(`          ${detail.slice(0, 400)}`);
    if (response.status === 401 || response.status === 403) {
      console.error("          The key was rejected. Check EMBEDDING_API_KEY.");
    }
    if (response.status === 404) {
      console.error(`          Check the model name and that ${endpoint} is the right path.`);
    }
    if (response.status === 400 && sendDimensions) {
      console.error("          Some providers reject an unknown 'dimensions' field. If this");
      console.error("          model is natively 1536 wide, set EMBEDDING_OMIT_DIMENSIONS=true.");
    }
    console.error("");
    return 1;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error("  FAILED  the provider returned a 200 that was not JSON.\n");
    return 1;
  }

  const vector = payload?.data?.[0]?.embedding;

  if (!Array.isArray(vector)) {
    console.error("  FAILED  no embedding in the response. Shape received:");
    console.error(`          ${JSON.stringify(payload).slice(0, 300)}\n`);
    return 1;
  }

  if (vector.length !== EMBEDDING_DIMENSIONS) {
    console.error(`  FAILED  the provider returned ${vector.length} dimensions; the schema expects ${EMBEDDING_DIMENSIONS}.`);
    console.error("");
    console.error("          Two ways out, and only two:");
    console.error("            1. Use a Matryoshka model that honours 'dimensions' —");
    console.error("               gemini-embedding-001, qwen3-embedding:4b or :8b.");
    console.error(`            2. Migrate the vector(${EMBEDDING_DIMENSIONS}) column to ${vector.length}`);
    console.error("               and re-index every document already stored.");
    console.error("");
    console.error("          Do not proceed. A short vector is rejected by pgvector on write,");
    console.error("          and a wrong-model vector of the right width is worse — it stores");
    console.error("          cleanly and returns nonsense.");
    console.error("");
    return 1;
  }

  // A vector of all zeros is a 200 that means nothing, and some providers emit it
  // for an empty or unsupported input rather than erroring.
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    console.error("  FAILED  the provider returned a zero or non-finite vector.\n");
    return 1;
  }

  console.log(`  OK      ${vector.length} dimensions, magnitude ${magnitude.toFixed(4)}, ${elapsed} ms`);
  console.log("");
  console.log("  Embeddings are configured correctly and match the schema.");
  console.log("");
  console.log("  One thing this cannot check: whether the corpus already in the database was");
  console.log("  embedded by this same model. Vectors from different models are the right");
  console.log("  width and still not comparable. If you have changed provider or model since");
  console.log("  indexing anything, re-index everything.");
  console.log("");
  return 0;
}

// `process.exitCode` rather than `process.exit()`: the latter tears the loop
// down while fetch keep-alive handles are still open, which aborts hard on
// Windows. A diagnostic that crashes on its own failure path is not one.
process.exitCode = await main();
