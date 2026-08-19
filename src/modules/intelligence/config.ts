import "server-only";

/**
 * Phase 4 (Advanced AI & Knowledge Intelligence) configuration.
 *
 * The theme of every number here: these features run on *upload*, unattended,
 * across whatever AIC has accumulated. Unlike Ask — where a person is waiting
 * and paying attention — nobody sees a slow or expensive summary happen. That
 * makes an unbounded cost here far easier to miss than an unbounded cost there.
 */

/**
 * The model for summarising and tagging.
 *
 * Haiku, not the answering model. Both jobs are close to extraction: the
 * summary restates what a document says, and the tags name what it is about.
 * Neither is a reasoning problem, and both run on every upload.
 */
export const INTELLIGENCE_MODEL = "claude-haiku-4-5-20251001";

/* -------------------------------------------------------------------------- */
/* Summarisation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How much of a document is read to summarise it.
 *
 * The opening of a business document — a policy, an update, an i363 form —
 * carries its purpose. Reading a 200-page PDF in full to produce three
 * sentences would cost roughly fifty times as much for a summary nobody would
 * judge as better.
 *
 * If summaries start missing conclusions that live at the end of documents,
 * the fix is sampling the tail as well, not simply raising this.
 */
export const SUMMARY_INPUT_MAX_CHARS = 24_000;

/** Three or four sentences. Enough to decide whether to open the document. */
export const SUMMARY_MAX_TOKENS = 400;

/** Ceiling on the stored summary, so a dashboard row stays a row. */
export const SUMMARY_MAX_CHARS = 700;

/* -------------------------------------------------------------------------- */
/* Tag suggestion                                                             */
/* -------------------------------------------------------------------------- */

/** Tagging reads less than summarising: a document's subject shows up early. */
export const TAGGING_INPUT_MAX_CHARS = 8_000;

export const TAGGING_MAX_TOKENS = 200;

/**
 * Most tags to propose.
 *
 * Deliberately below `MAX_TAGS_PER_DOCUMENT`. A suggestion list longer than the
 * shelf it fills is not a suggestion, it is a chore — and a person who is
 * handed twelve checkboxes accepts all of them without reading, which is worse
 * than no tags at all.
 */
export const MAX_SUGGESTED_TAGS = 5;

/* -------------------------------------------------------------------------- */
/* Related documents                                                          */
/* -------------------------------------------------------------------------- */

/** How many related documents to show alongside one. */
export const RELATED_DOCUMENT_COUNT = 5;

/**
 * Similarity floor for "related".
 *
 * Much higher than the retrieval floor (0.15) on purpose. Retrieval can afford
 * a weak passage because the model reads it and decides; a "Related documents"
 * list has no such filter — every entry is a claim, made in the interface, that
 * these two documents belong together. A wrong one is visibly wrong.
 */
export const RELATED_MIN_SIMILARITY = 0.5;
