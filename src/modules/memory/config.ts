import "server-only";

/**
 * Conversation memory configuration, and the reasoning behind each number.
 *
 * The constraint that shapes all of this: an AI feature reads and writes far
 * more per interaction than a CRUD screen does. One question touches the
 * conversation row, the message rows, the citation rows, and the entire chunk
 * table via retrieval. Every number below exists to stop that cost growing with
 * the length of the thread.
 */

/* -------------------------------------------------------------------------- */
/* Working memory — the turns replayed to the model                           */
/* -------------------------------------------------------------------------- */

/**
 * How many prior turns (a turn being one question or one answer) are sent back
 * to the model with a new question.
 *
 * Twelve is six exchanges. Past that, in a grounded question-answering tool,
 * the older turns are almost never what the current question depends on — they
 * are a different subject the person happened to ask about in the same sitting.
 * The rolling summary carries whatever mattered.
 */
export const HISTORY_TURN_LIMIT = 12;

/**
 * Hard ceiling on replayed history, in characters.
 *
 * A turn limit alone is not a budget: one answer over a long policy document
 * can be several thousand characters on its own. This caps the actual payload,
 * dropping oldest-first when both limits disagree.
 */
export const HISTORY_MAX_CHARS = 12_000;

/**
 * Prior answers are truncated to this before being replayed.
 *
 * The model needs to know what it already said, not to re-read all of it. The
 * opening of an answer carries the conclusion — the tail is usually caveats and
 * citations that are stale by the next question anyway.
 */
export const REPLAYED_ANSWER_MAX_CHARS = 1_200;

/* -------------------------------------------------------------------------- */
/* Long-term memory — the rolling summary                                     */
/* -------------------------------------------------------------------------- */

/**
 * Summarise once a thread passes this many messages, folding everything older
 * than `HISTORY_TURN_LIMIT` into `conversations.summary`.
 *
 * Set above the turn limit so a thread that never grows past the working window
 * never pays for a summary it would not use.
 */
export const SUMMARY_TRIGGER_MESSAGES = 16;

/** Ceiling on the stored summary, so it cannot itself become the context problem. */
export const SUMMARY_MAX_CHARS = 1_500;

/* -------------------------------------------------------------------------- */
/* Follow-up resolution                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The model that rewrites a follow-up into a standalone search query, and that
 * writes thread summaries and titles.
 *
 * Haiku, not the answering model: both jobs are short rewrites on short inputs,
 * they sit in front of the answer the person is waiting for, and running them
 * on Opus would add latency to every follow-up for no gain in retrieval quality.
 *
 * Undated, matching `INTELLIGENCE_MODEL` — see the note there.
 */
export const UTILITY_MODEL = "claude-haiku-4-5";

/** Rewritten queries are one line; a larger budget only buys a preamble. */
export const REWRITE_MAX_TOKENS = 200;

/** Summaries are a short paragraph. */
export const SUMMARY_MAX_TOKENS = 600;

/* -------------------------------------------------------------------------- */
/* Threads                                                                    */
/* -------------------------------------------------------------------------- */

/** Threads listed in the Ask sidebar. */
export const CONVERSATION_LIST_LIMIT = 30;

/** Longest a generated thread title may be before it is trimmed. */
export const TITLE_MAX_CHARS = 60;
