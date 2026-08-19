import "server-only";

/**
 * RAG configuration, and the record of the research decisions behind it
 * (plan §9). Every number here is a choice that can be revisited without
 * touching pipeline code.
 */

/* -------------------------------------------------------------------------- */
/* Chunking                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Target chunk size in characters, not tokens.
 *
 * Tokenising during ingestion would mean a network round trip per document
 * just to split it. ~4 characters per token is close enough for English prose,
 * so 3200 characters lands around 800 tokens — small enough that a retrieved
 * passage is mostly relevant, large enough to keep a policy paragraph or a
 * table row intact.
 */
export const CHUNK_TARGET_CHARS = 3200;

/** Never emit a chunk shorter than this unless it is the tail of a document. */
export const CHUNK_MIN_CHARS = 240;

/**
 * Overlap between neighbouring chunks.
 *
 * Without it, a sentence that straddles a boundary is retrievable from neither
 * side. 400 characters is roughly two sentences of context on each seam.
 */
export const CHUNK_OVERLAP_CHARS = 400;

/* -------------------------------------------------------------------------- */
/* Embeddings                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Embedding vector width.
 *
 * This is pinned by the `vector(1536)` column in migration 0001. Changing the
 * embedding model to one with a different width means a migration that alters
 * that column and re-indexes every document — it is not an env-var change.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/** How many chunks to embed in one provider request. */
export const EMBEDDING_BATCH_SIZE = 64;

/* -------------------------------------------------------------------------- */
/* Retrieval                                                                  */
/* -------------------------------------------------------------------------- */

/** Passages fed to the model per question. */
export const RETRIEVAL_CHUNK_COUNT = 10;

/**
 * Cosine-similarity floor.
 *
 * Below this, a passage is noise that would invite the model to answer from a
 * document that does not actually discuss the question. Better to return
 * nothing and say so.
 */
export const RETRIEVAL_MIN_SIMILARITY = 0.15;

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Claude Opus 5 for answer generation.
 *
 * Still an open question for Bishop on privacy grounds (plan §9): company
 * documents leave AIC's network to be answered. Nothing else in the platform
 * sends document content anywhere.
 */
export const ANSWER_MODEL = "claude-opus-5";

/**
 * Generous because thinking tokens share this budget with the answer text on
 * Claude Opus 5, and the request streams — so a large ceiling costs nothing
 * except when it is actually used.
 */
export const ANSWER_MAX_TOKENS = 8192;

/**
 * Reasoning effort.
 *
 * Grounded question-answering over retrieved passages is close to extraction:
 * the hard part was retrieval, and higher effort mostly buys latency here. Raise
 * this if answers start missing conclusions that span several documents.
 */
export const ANSWER_EFFORT = "low" as const;

/**
 * Server-side refusal fallback.
 *
 * Claude Opus 5's safety classifiers occasionally decline benign requests; with
 * this on, the API silently re-runs the request on a fallback model instead of
 * handing the user an empty answer. Set to false if the beta is not enabled on
 * AIC's Anthropic account.
 */
export const USE_REFUSAL_FALLBACK = true;
