#!/usr/bin/env node
/**
 * Proves the configured answering provider, and that it streams.
 *
 * The counterpart to verify-embeddings.mjs, and a shallower check by nature:
 * nothing this provider produces is stored, so a wrong choice costs a bad
 * answer rather than a corrupted corpus. What it does catch is the class of
 * mistake that presents as "Ask is broken" with nothing useful in the logs —
 * a model id that does not exist on this provider, a key the provider rejects,
 * a base URL missing its /v1, and a provider that accepts `stream: true` and
 * then sends a single non-streamed body.
 *
 * That last one matters more than it sounds. The Ask page renders deltas as
 * they arrive; a provider that buffers the whole answer and sends it at the end
 * still "works" and still feels broken, because the reader watches an empty
 * pane for the entire generation.
 *
 *   npm run verify:answering
 *
 * Costs one short completion, capped low.
 */

import { readFileSync } from "node:fs";

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

/** Mirrors `getAnswerProvider` in src/modules/rag/answer-provider.ts. */
function resolveProvider() {
  const provider = (process.env.ANSWER_PROVIDER ?? "anthropic").trim();
  const model = process.env.ANSWER_MODEL?.trim();

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      return { error: "ANSWER_PROVIDER is anthropic but ANTHROPIC_API_KEY is not set." };
    }
    return { id: "anthropic", model: model || "claude-opus-5", skip: true };
  }

  if (provider === "openai-compatible") {
    const baseUrl = process.env.ANSWER_BASE_URL?.trim();
    if (!baseUrl) return { error: "ANSWER_PROVIDER is openai-compatible but ANSWER_BASE_URL is not set." };
    if (!model) return { error: "ANSWER_PROVIDER is openai-compatible but ANSWER_MODEL is not set." };
    return {
      id: "openai-compatible",
      baseUrl,
      apiKey: process.env.ANSWER_API_KEY?.trim() || null,
      model,
    };
  }

  return { error: `ANSWER_PROVIDER is "${provider}", which is not one of anthropic, openai-compatible.` };
}

async function main() {
  const provider = resolveProvider();

  if (provider.error) {
    console.error(`\n  ${provider.error}`);
    console.error("  Ask will report that answering is unconfigured and fall back to keyword search.\n");
    return 1;
  }

  if (provider.skip) {
    console.log(`\n  provider    anthropic (${provider.model})`);
    console.log("  Not probed: the Anthropic SDK is exercised by the application itself,");
    console.log("  and this script exists for the endpoints that are configured by hand.\n");
    return 0;
  }

  const endpoint = `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  console.log("");
  console.log(`  provider    ${provider.id}`);
  console.log(`  endpoint    ${endpoint}`);
  console.log(`  model       ${provider.model}`);
  console.log(`  api key     ${provider.apiKey ? `set (${provider.apiKey.length} chars)` : "none"}`);
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
        messages: [
          { role: "system", content: "Answer in exactly one short sentence." },
          { role: "user", content: "Say the words: retrieval is configured." },
        ],
        max_tokens: 64,
        stream: true,
      }),
    });
  } catch (cause) {
    console.error(`  FAILED  could not reach ${endpoint}`);
    console.error(`          ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`  FAILED  HTTP ${response.status} from the provider`);
    if (detail) console.error(`          ${detail.slice(0, 400)}`);
    if (response.status === 401 || response.status === 403) {
      console.error("          The key was rejected. Check ANSWER_API_KEY.");
    }
    if (response.status === 404) {
      console.error("          Usually the model id. List what this provider actually serves:");
      console.error(`            curl -s ${provider.baseUrl.replace(/\/+$/, "")}/models`);
    }
    console.error("");
    return 1;
  }

  if (!response.body) {
    console.error("  FAILED  the provider returned no body to stream.\n");
    return 1;
  }

  // Parse the stream exactly as answer-provider.ts does, including buffering
  // across chunk boundaries — if the real parser would break on this provider,
  // this one should break identically rather than being more forgiving.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let frames = 0;
  let firstDeltaAt = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") { buffer = ""; break; }
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          if (firstDeltaAt === null) firstDeltaAt = Date.now() - started;
          frames += 1;
          text += delta;
        }
      } catch {
        continue;
      }
    }
  }

  const elapsed = Date.now() - started;

  if (!text) {
    console.error("  FAILED  the stream carried no text.");
    console.error("          A 200 with no content is what a refusal or a content filter");
    console.error("          looks like on these providers.\n");
    return 1;
  }

  console.log(`  OK      streamed ${frames} frame${frames === 1 ? "" : "s"}, first token at ${firstDeltaAt} ms, done at ${elapsed} ms`);
  console.log(`  answer  ${JSON.stringify(text.trim().slice(0, 120))}`);
  console.log("");

  // One frame means the provider accepted `stream: true` and then sent the whole
  // answer at once. It works, and the Ask page will show nothing until the end.
  if (frames === 1) {
    console.log("  NOTE    only one frame arrived, so this provider is not really streaming.");
    console.log("          Ask will work and will feel broken: the pane stays empty until");
    console.log("          the whole answer lands.");
    console.log("");
  }

  console.log("  Answering is configured correctly.");
  console.log("");
  return 0;
}

// `process.exitCode` rather than `process.exit()`: the latter tears the loop
// down while fetch keep-alive handles are still open, which aborts hard on
// Windows.
process.exitCode = await main();
