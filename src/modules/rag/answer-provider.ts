import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  ANSWER_EFFORT,
  ANSWER_MAX_TOKENS,
  ANSWER_MODEL,
  USE_REFUSAL_FALLBACK,
} from "@/modules/rag/config";

/**
 * Answer generation, behind a provider interface.
 *
 * The same move `embed.ts` makes, and for the same reason: which vendor answers
 * is a decision that has changed once and will change again, so the code should
 * not encode it. Unlike embeddings, nothing a provider produces here is stored
 * — each question is a fresh call and the answer is the whole output — so
 * switching costs nothing and needs no re-index.
 *
 * Two implementations, because they are genuinely different protocols rather
 * than one protocol with two hostnames. Anthropic's SDK carries adaptive
 * thinking, an effort setting and server-side refusal fallbacks that have no
 * equivalent in the OpenAI shape; the OpenAI shape is a raw SSE stream that has
 * to be parsed by hand. Pretending they are the same would mean giving up the
 * parts of the Anthropic path that exist for a reason.
 */

/** Role and content, the shape both protocols agree on. */
export type ChatMessage = { role: "user" | "assistant"; content: string };

/** What a provider emits while streaming. `done` is added by the caller. */
export type ProviderEvent =
  | { type: "delta"; text: string }
  | { type: "error"; message: string };

export type AnswerProvider = {
  id: string;
  model: string;
  stream(system: string, messages: ChatMessage[]): AsyncGenerator<ProviderEvent>;
};

/* -------------------------------------------------------------------------- */
/* Anthropic                                                                  */
/* -------------------------------------------------------------------------- */

function anthropicProvider(model: string): AnswerProvider {
  return {
    id: "anthropic",
    model,
    async *stream(system, messages) {
      const client = new Anthropic();

      // The beta endpoint is used only for `fallbacks`: Claude Opus 5's safety
      // classifiers occasionally decline a benign request, and without a
      // fallback the person asking just gets an empty answer.
      const stream = USE_REFUSAL_FALLBACK
        ? client.beta.messages.stream({
            model,
            max_tokens: ANSWER_MAX_TOKENS,
            system,
            thinking: { type: "adaptive" },
            output_config: { effort: ANSWER_EFFORT },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            messages,
          })
        : client.messages.stream({
            model,
            max_tokens: ANSWER_MAX_TOKENS,
            system,
            thinking: { type: "adaptive" },
            output_config: { effort: ANSWER_EFFORT },
            messages,
          });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "delta", text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();

      // A refusal that survived the fallback arrives as a 200 with no text, so
      // it has to be reported explicitly rather than read as an empty answer.
      if (final.stop_reason === "refusal") {
        yield {
          type: "error",
          message:
            "The model declined to answer that question. Rephrasing it usually helps.",
        };
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* OpenAI-compatible chat completions                                         */
/* -------------------------------------------------------------------------- */

/**
 * Reads one `text/event-stream` body and yields the text deltas.
 *
 * Written out rather than pulled from a package because the format is four
 * rules and the buffering is the only part with a real bug in it: a chunk
 * boundary can land mid-line, so lines are only consumed once a newline has
 * actually arrived. Splitting each chunk independently would drop or corrupt
 * whichever delta straddled the boundary, and would do it intermittently —
 * under load, and never in a test.
 */
async function* parseSseDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);

        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;

        // A malformed chunk is skipped rather than thrown: one unparseable
        // frame should not discard an answer that is otherwise streaming
        // correctly.
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string | null } }[];
          };
          const text = parsed.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function openAiCompatibleProvider(options: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}): AnswerProvider {
  const { baseUrl, apiKey, model } = options;
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    id: "openai-compatible",
    model,
    async *stream(system, messages) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          // The system prompt is a message here rather than a top-level field,
          // which is the one structural difference from the Anthropic call.
          messages: [{ role: "system", content: system }, ...messages],
          max_tokens: ANSWER_MAX_TOKENS,
          stream: true,
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        yield {
          type: "error",
          message:
            `The answering provider refused the request (${response.status})` +
            (detail ? `: ${detail.slice(0, 300)}` : "."),
        };
        return;
      }

      let produced = false;
      for await (const text of parseSseDeltas(response.body)) {
        produced = true;
        yield { type: "delta", text };
      }

      // An empty 200 is the shape a content filter takes on most of these
      // providers. Reporting it as an error rather than as a blank answer keeps
      // it distinguishable from "the passages did not cover it", which is a
      // conclusion the model is supposed to state in words.
      if (!produced) {
        yield {
          type: "error",
          message:
            "The model returned an empty answer. Rephrasing the question usually helps.",
        };
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The configured provider, or null when answering is not set up.
 *
 * Null rather than a throw, matching `getEmbeddingProvider`: Ask degrades to
 * keyword search without an answering provider, and that is a supported state
 * rather than a fault.
 */
export function getAnswerProvider(): AnswerProvider | null {
  const provider = (process.env.ANSWER_PROVIDER ?? "anthropic").trim();
  const model = process.env.ANSWER_MODEL?.trim();

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
    return anthropicProvider(ANSWER_MODEL);
  }

  if (provider === "openai-compatible") {
    const baseUrl = process.env.ANSWER_BASE_URL?.trim();
    if (!baseUrl || !model) return null;
    return openAiCompatibleProvider({
      baseUrl,
      apiKey: process.env.ANSWER_API_KEY?.trim() || null,
      model,
    });
  }

  return null;
}

export function answeringConfigured(): boolean {
  return getAnswerProvider() !== null;
}

/** Exported for tests: the SSE parsing is the part with a real failure mode. */
export const __testing = { parseSseDeltas };
