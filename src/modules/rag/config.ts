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
/* Contextual embeddings                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Embed each chunk together with a short description of the document it came
 * from, rather than the chunk alone.
 *
 * Chunking throws away the context that made a passage meaningful: "the fee is
 * GHS 500" names neither the programme nor the year, so it sits nowhere near
 * the question it answers. Prefixing the title, tags and summary at embedding
 * time puts it back.
 *
 * Off is the pre-existing behaviour. Turning it off does not require a
 * re-index to be *correct* — old and new vectors are the same width and the
 * same space — but retrieval will be uneven until every document is on the
 * same setting, so treat a change here as a re-index.
 */
export const CONTEXTUAL_EMBEDDINGS = true;

/**
 * Ceiling on the whole header.
 *
 * Every character here is added to every chunk of the document, so this trades
 * embedding cost against context. 600 covers a title, a tag list and two
 * sentences of summary; beyond that the header starts to dominate short
 * passages and pull their embeddings toward the document average, which is the
 * opposite of what this is for.
 */
export const CONTEXT_HEADER_MAX_CHARS = 600;

/** How much of the document summary the header may carry. */
export const CONTEXT_SUMMARY_MAX_CHARS = 400;

/* -------------------------------------------------------------------------- */
/* Retrieval                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Passages fed to the model per question.
 *
 * Raised from 10 to 25 on 3 September, on measurement rather than instinct.
 * The old ceiling was set when Claude Opus answered and every token was money.
 * Against the model that answers now, a probe hid one fact among forty filler
 * passages and it was quoted back correctly in 684 ms; a 400 KB single passage
 * — roughly 104k tokens — still had its needle recalled. The model was nowhere
 * near its limit, so the cap was throttling answer quality rather than
 * protecting anything.
 *
 * 25 rather than the 50 the RPCs permit: past a couple of dozen passages the
 * cost is the reader's attention, not the model's context. An answer assembled
 * from fifty sources is one nobody checks.
 */
export const RETRIEVAL_CHUNK_COUNT = 25;

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
 * The model that answers questions. Claude Opus 5 unless overridden.
 *
 * Still an open question for Bishop on privacy grounds (plan §9): company
 * documents leave AIC's network to be answered. Nothing else in the platform
 * sends document content anywhere.
 *
 * Overridable per environment because, unlike the embedding model, this one is
 * free to change. Nothing generated by it is stored — each question is a fresh
 * call and the answer is the whole output — so switching tiers costs nothing
 * and needs no re-index. `EMBEDDING_DIMENSIONS` is the opposite: change that
 * and every stored vector becomes meaningless.
 *
 * Intended use is a cheaper tier while iterating (`claude-haiku-4-5`) and the
 * default in front of anyone whose trust matters. The gap between tiers is
 * small on the common case — a passage contains the answer, restate it and cite
 * it — and shows up on the case that decides whether the system is believed:
 * saying "the passages do not cover that" instead of writing something
 * plausible. Do not demo on a tier you have not read the refusals from.
 */
export const ANSWER_MODEL = process.env.ANSWER_MODEL?.trim() || "claude-opus-5";

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
