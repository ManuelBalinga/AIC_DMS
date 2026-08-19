import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  ANSWER_EFFORT,
  ANSWER_MAX_TOKENS,
  ANSWER_MODEL,
  USE_REFUSAL_FALLBACK,
} from "@/modules/rag/config";
import type { Passage } from "@/modules/rag/retrieve";

/**
 * Grounded answer generation with source references (plan §6.4 steps 4–5).
 *
 * The passages handed in have already been filtered by the database to what the
 * asker is allowed to read, so this file never reasons about permissions. Its
 * only job is to keep the answer inside those passages.
 */

export type AnswerSource = {
  /** The bracket number the answer cites, 1-indexed. */
  number: number;
  documentId: string;
  documentTitle: string;
  pageNumber: number | null;
  /** Short lead-in from the passage, for the "why this source" hover. */
  excerpt: string;
};

const SYSTEM_PROMPT = `You answer questions about the Accra Innovation Center's internal documents.

You are given numbered passages retrieved from documents the person asking is authorised to read. Answer only from those passages.

Cite every factual claim with the passage number in square brackets, like [2]. Cite the passages you actually used, and cite more than one when a claim rests on more than one.

When the passages do not contain the answer, say so plainly and name what is missing — "the passages don't cover the 2026 fee schedule" is useful; a guess is not. Do not fall back on general knowledge about innovation centres, training programmes, or anything else outside the passages.

When the passages disagree, say that they disagree and cite both.

Answer in prose, and keep it to the length the question needs. Lead with the answer rather than restating the question. Do not describe the passages as "the provided context" or "the documents I was given" — the person knows where the answer came from, and the citations already say which.`;

function buildSourceBlock(passages: Passage[]): {
  prompt: string;
  sources: AnswerSource[];
} {
  const sources: AnswerSource[] = [];
  const parts: string[] = [];

  for (const [position, passage] of passages.entries()) {
    const number = position + 1;

    parts.push(
      `<passage number="${number}" document="${passage.document_title}"${
        passage.page_number === null ? "" : ` page="${passage.page_number}"`
      }>\n${passage.content}\n</passage>`,
    );

    sources.push({
      number,
      documentId: passage.document_id,
      documentTitle: passage.document_title,
      pageNumber: passage.page_number,
      excerpt: `${passage.content.slice(0, 220).trim()}${
        passage.content.length > 220 ? "…" : ""
      }`,
    });
  }

  return { prompt: parts.join("\n\n"), sources };
}

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type AnswerEvent =
  | { type: "sources"; sources: AnswerSource[] }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Streams a grounded answer.
 *
 * Streamed rather than awaited because the first token arrives long before the
 * last, and a page that shows nothing for eight seconds reads as broken.
 */
export async function* streamAnswer(
  question: string,
  passages: Passage[],
): AsyncGenerator<AnswerEvent> {
  if (!anthropicConfigured()) {
    yield {
      type: "error",
      message:
        "AI answering is not configured yet — no ANTHROPIC_API_KEY is set on the server.",
    };
    return;
  }

  if (passages.length === 0) {
    yield { type: "sources", sources: [] };
    yield {
      type: "delta",
      text:
        "Nothing in the documents you can access covers that. If you expected a " +
        "document to be here, it may not have been shared with you yet, or it may " +
        "still be waiting to be indexed.",
    };
    yield { type: "done" };
    return;
  }

  const { prompt, sources } = buildSourceBlock(passages);
  yield { type: "sources", sources };

  const client = new Anthropic();

  try {
    // The beta endpoint is used only for `fallbacks`: Claude Opus 5's safety
    // classifiers occasionally decline a benign request, and without a fallback
    // the person asking just gets an empty answer.
    const stream = USE_REFUSAL_FALLBACK
      ? client.beta.messages.stream({
          model: ANSWER_MODEL,
          max_tokens: ANSWER_MAX_TOKENS,
          system: SYSTEM_PROMPT,
          thinking: { type: "adaptive" },
          output_config: { effort: ANSWER_EFFORT },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages: [
            {
              role: "user",
              content: `${prompt}\n\nQuestion: ${question}`,
            },
          ],
        })
      : client.messages.stream({
          model: ANSWER_MODEL,
          max_tokens: ANSWER_MAX_TOKENS,
          system: SYSTEM_PROMPT,
          thinking: { type: "adaptive" },
          output_config: { effort: ANSWER_EFFORT },
          messages: [
            {
              role: "user",
              content: `${prompt}\n\nQuestion: ${question}`,
            },
          ],
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

    // A refusal that survived the fallback arrives as a 200 with no text, so it
    // has to be reported explicitly rather than read as an empty answer.
    if (final.stop_reason === "refusal") {
      yield {
        type: "error",
        message:
          "The model declined to answer that question. Rephrasing it usually helps.",
      };
      return;
    }

    yield { type: "done" };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    yield { type: "error", message: `The answer could not be generated: ${message}` };
  }
}
