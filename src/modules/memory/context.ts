import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  HISTORY_MAX_CHARS,
  HISTORY_TURN_LIMIT,
  REPLAYED_ANSWER_MAX_CHARS,
  REWRITE_MAX_TOKENS,
  SUMMARY_MAX_CHARS,
  SUMMARY_MAX_TOKENS,
  TITLE_MAX_CHARS,
  UTILITY_MODEL,
} from "@/modules/memory/config";
import type { Conversation, ConversationMessage } from "@/lib/types/database";

/**
 * Turning a stored thread into the context a single question is answered with.
 *
 * This is the part of "memory" that is not storage. Three jobs:
 *
 *   1. Choose which turns to replay to the answering model (working memory).
 *   2. Rewrite a follow-up into a question that can be retrieved on its own.
 *   3. Fold turns that fell out of the window into a summary (long-term memory).
 *
 * Job 2 is the one that matters most and is easiest to miss. Retrieval matches
 * a question against passages by meaning. "What about the fees?" has almost no
 * meaning without the turn before it, so a naive follow-up retrieves noise and
 * the model then answers from noise. Passing history to the *generator* does
 * not fix this — the wrong passages were already chosen by then.
 */

/** A turn as replayed to the model. */
export type HistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Strips `[3]` style citations out of a replayed answer.
 *
 * Those numbers referred to passages retrieved for an earlier question, and
 * this question has its own numbering. Leaving them in invites the model to
 * carry a stale number into a new answer, where it would point at the wrong
 * document — a citation that looks right and is not is worse than none.
 */
function stripCitations(text: string): string {
  return text.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, "");
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()}…`;
}

/**
 * Builds the working-memory window from stored turns.
 *
 * Trimmed from the oldest end, because the turn a follow-up depends on is
 * nearly always the most recent one. Dropping the newest turn to fit a budget
 * would break exactly the case this feature exists for.
 */
export function buildHistoryWindow(messages: ConversationMessage[]): HistoryTurn[] {
  const turns: HistoryTurn[] = messages
    .slice(-HISTORY_TURN_LIMIT)
    .map((message) => ({
      role: message.role,
      content:
        message.role === "assistant"
          ? truncate(stripCitations(message.content), REPLAYED_ANSWER_MAX_CHARS)
          : message.content,
    }))
    .filter((turn) => turn.content.length > 0);

  let total = turns.reduce((sum, turn) => sum + turn.content.length, 0);
  while (turns.length > 0 && total > HISTORY_MAX_CHARS) {
    total -= turns[0].content.length;
    turns.shift();
  }

  // A window that opens on an assistant turn reads as an answer to a question
  // the model cannot see. Drop it so the replay always starts with a question.
  while (turns.length > 0 && turns[0].role === "assistant") {
    turns.shift();
  }

  return turns;
}

function utilityConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function completeText(
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> {
  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: UTILITY_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    return text || null;
  } catch {
    // Every caller has a usable fallback, and none of them is worth failing a
    // question over. A degraded rewrite costs retrieval quality; a thrown error
    // costs the answer entirely.
    return null;
  }
}

const REWRITE_SYSTEM = `You rewrite a follow-up question into a standalone search query for a document search system.

Resolve every pronoun and every implicit reference against the conversation, so the query makes sense with no conversation attached. Keep the specific nouns, names, numbers and identifiers the person used — they are what the search matches on.

Output the rewritten query alone. No preamble, no quotes, no explanation.

If the question already stands on its own, output it unchanged.`;

/**
 * Rewrites a follow-up into a question retrieval can act on.
 *
 * Falls back to appending the previous question rather than the previous answer
 * when the rewrite is unavailable: the previous question is short and on-topic,
 * while an answer is long enough to dominate the embedding and pull retrieval
 * toward whatever that answer happened to discuss.
 */
export async function resolveQuery(
  question: string,
  history: HistoryTurn[],
): Promise<{ query: string; rewritten: boolean }> {
  if (history.length === 0) return { query: question, rewritten: false };

  if (utilityConfigured()) {
    const transcript = history
      .map((turn) => `${turn.role === "user" ? "Question" : "Answer"}: ${turn.content}`)
      .join("\n\n");

    const rewritten = await completeText(
      REWRITE_SYSTEM,
      `Conversation so far:\n\n${transcript}\n\nFollow-up question: ${question}\n\nStandalone query:`,
      REWRITE_MAX_TOKENS,
    );

    if (rewritten) {
      return { query: rewritten, rewritten: rewritten !== question };
    }
  }

  const lastQuestion = [...history].reverse().find((turn) => turn.role === "user");
  if (!lastQuestion) return { query: question, rewritten: false };

  return { query: `${lastQuestion.content} ${question}`, rewritten: true };
}

const SUMMARY_SYSTEM = `You maintain a running summary of a conversation about internal company documents.

Write a compact paragraph covering: what the person is trying to find out, which documents and topics have come up, and any conclusions already reached. Keep names, identifiers and figures verbatim — they are what later questions refer back to.

Write it as notes, not prose about the conversation. Output the summary alone.`;

/**
 * Folds turns that have aged out of the working window into a stored summary.
 *
 * Returns null when there is nothing to add or the model is unavailable, in
 * which case the thread simply keeps its previous summary — losing the oldest
 * context is an acceptable degradation, failing the question is not.
 */
export async function summariseOlderTurns(
  existing: Conversation["summary"],
  aged: ConversationMessage[],
): Promise<string | null> {
  if (aged.length === 0 || !utilityConfigured()) return null;

  const transcript = aged
    .map(
      (message) =>
        `${message.role === "user" ? "Question" : "Answer"}: ${
          message.role === "assistant"
            ? truncate(stripCitations(message.content), REPLAYED_ANSWER_MAX_CHARS)
            : message.content
        }`,
    )
    .join("\n\n");

  const summary = await completeText(
    SUMMARY_SYSTEM,
    existing
      ? `Summary so far:\n\n${existing}\n\nNewly aged-out turns:\n\n${transcript}\n\nUpdated summary:`
      : `Conversation turns:\n\n${transcript}\n\nSummary:`,
    SUMMARY_MAX_TOKENS,
  );

  return summary ? truncate(summary, SUMMARY_MAX_CHARS) : null;
}

/**
 * Names a thread from its opening question.
 *
 * Derived locally rather than by asking a model: it runs on the first question
 * of every thread, and a title is worth no latency at all. The first clause of
 * a question is a good title far more often than not.
 */
export function titleFromQuestion(question: string): string {
  const firstClause = question.trim().split(/[\n?.!]/)[0]?.trim() || question.trim();
  const title = truncate(firstClause, TITLE_MAX_CHARS);
  return title.charAt(0).toUpperCase() + title.slice(1);
}
