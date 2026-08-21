import "server-only";

/**
 * The length limits live in `limits.ts`, which is not `server-only`, so the
 * forms enforce exactly the numbers the actions do. Re-exported here so server
 * code has one place to look.
 */
export { MAX_MESSAGE_LENGTH, MAX_TOPIC_LENGTH } from "@/modules/chat/limits";

/** Messages loaded when a thread is opened, newest-last. */
export const THREAD_PAGE_SIZE = 100;

/**
 * Messages Ask may ground an answer in, per question.
 *
 * Deliberately smaller than `RETRIEVAL_CHUNK_COUNT`. A message is one or two
 * sentences where a chunk is several paragraphs, so an equal count would let
 * chat crowd documents out of the context window while carrying far less
 * information. Documents remain the primary source; messages fill the gap
 * where a decision was made in conversation and never written down.
 */
export const MESSAGE_RETRIEVAL_COUNT = 4;

/**
 * Similarity floor for message retrieval, higher than the document floor.
 *
 * Short texts produce noisier embeddings, and a marginal match here is worse
 * than a marginal match on a document: quoting a colleague's half-remembered
 * aside as though it settled something is a specific kind of wrong.
 */
export const MESSAGE_MIN_SIMILARITY = 0.35;
