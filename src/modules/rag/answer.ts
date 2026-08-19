import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  ANSWER_EFFORT,
  ANSWER_MAX_TOKENS,
  ANSWER_MODEL,
  USE_REFUSAL_FALLBACK,
} from "@/modules/rag/config";
import type { Passage } from "@/modules/rag/retrieve";
import type { HistoryTurn } from "@/modules/memory/context";

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

Answer in prose, and keep it to the length the question needs. Lead with the answer rather than restating the question. Do not describe the passages as "the provided context" or "the documents I was given" — the person knows where the answer came from, and the citations already say which.

Earlier turns of the conversation may appear before the current question. Use them to understand what is being asked, not as a source: the passages below are the only thing you may state facts from, and the bracket numbers refer to those passages alone. If an earlier turn covered something the current passages do not, say that the current passages do not cover it rather than repeating it as fact.`;

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

/** What the conversation contributes to a single question. */
export type AnswerMemory = {
  /** Recent turns, already trimmed and citation-stripped by the memory module. */
  history?: HistoryTurn[];
  /** Rolling summary of turns that have aged out of the replay window. */
  summary?: string | null;
};

/**
 * Assembles the message array.
 *
 * The passages ride on the final user turn rather than in the system prompt,
 * because they are specific to this question — putting them in `system` would
 * imply they applied to the whole conversation, and the earlier turns were
 * answered from entirely different passages.
 *
 * The summary does go in `system`: it describes the conversation rather than
 * this question, and framing it as a user turn would let the model mistake a
 * summary of past answers for a source it may cite.
 */
function buildMessages(
  question: string,
  passagePrompt: string,
  history: HistoryTurn[],
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  const push = (role: "user" | "assistant", content: string) => {
    const previous = messages.at(-1);

    // A question whose answer failed leaves a user turn with no reply, so the
    // history can hand us two user turns in a row. Merging them keeps the array
    // strictly alternating rather than relying on the API to tolerate it.
    if (previous && previous.role === role) {
      previous.content = `${previous.content}\n\n${content}`;
      return;
    }

    messages.push({ role, content });
  };

  for (const turn of history) push(turn.role, turn.content);
  push("user", `${passagePrompt}\n\nQuestion: ${question}`);

  return messages;
}

/**
 * Streams a grounded answer.
 *
 * Streamed rather than awaited because the first token arrives long before the
 * last, and a page that shows nothing for eight seconds reads as broken.
 */
export async function* streamAnswer(
  question: string,
  passages: Passage[],
  memory: AnswerMemory = {},
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

  const history = memory.history ?? [];
  const messages = buildMessages(question, prompt, history);
  const system = memory.summary
    ? `${SYSTEM_PROMPT}\n\nEarlier in this conversation:\n${memory.summary}`
    : SYSTEM_PROMPT;

  const client = new Anthropic();

  try {
    // The beta endpoint is used only for `fallbacks`: Claude Opus 5's safety
    // classifiers occasionally decline a benign request, and without a fallback
    // the person asking just gets an empty answer.
    const stream = USE_REFUSAL_FALLBACK
      ? client.beta.messages.stream({
          model: ANSWER_MODEL,
          max_tokens: ANSWER_MAX_TOKENS,
          system,
          thinking: { type: "adaptive" },
          output_config: { effort: ANSWER_EFFORT },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages,
        })
      : client.messages.stream({
          model: ANSWER_MODEL,
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
