import "server-only";

import { EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS } from "@/modules/rag/config";

/**
 * Embedding generation, behind a provider interface.
 *
 * Anthropic does not offer an embedding endpoint, so the retrieval half of the
 * pipeline necessarily uses a second vendor. That makes this the one place the
 * choice is pinned, and the one file to change when Bishop settles the privacy
 * question (plan §9 research questions 4 and 6).
 *
 * A provider must emit exactly `EMBEDDING_DIMENSIONS` floats: the width is
 * fixed by the `vector(1536)` column in migration 0001, so a provider with a
 * different native width needs a schema migration, not just a config change.
 */

export type EmbeddingProvider = {
  id: string;
  model: string;
  /** Embeds a batch, returning one vector per input in the same order. */
  embed(texts: string[]): Promise<number[][]>;
};

export type EmbeddingFailure = { ok: false; error: string };

/* -------------------------------------------------------------------------- */
/* OpenAI: text-embedding-3-small                                             */
/* -------------------------------------------------------------------------- */

/**
 * Chosen because its native width is 1536, matching the column the schema
 * already commits to, and because it is cheap enough that re-indexing the whole
 * corpus after a chunking change is not a budget decision.
 *
 * Called over `fetch` rather than through the `openai` package: this is one
 * endpoint with a stable request shape, and a whole SDK for it would be the
 * heaviest dependency in the project.
 */
function openAiProvider(apiKey: string, model: string): EmbeddingProvider {
  return {
    id: "openai",
    model,
    async embed(texts) {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `Embedding request failed (${response.status}): ${detail.slice(0, 300)}`,
        );
      }

      const payload = (await response.json()) as {
        data: { index: number; embedding: number[] }[];
      };

      // The API documents order preservation but also returns an index; sorting
      // by it means a future change on their side cannot silently pair the wrong
      // vector with the wrong chunk.
      return payload.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The configured provider, or null when embeddings are not set up.
 *
 * Null rather than a thrown error: the platform is fully usable without RAG,
 * and an unconfigured key should degrade AI search rather than break uploads.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const provider = process.env.EMBEDDING_PROVIDER ?? "openai";

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    return openAiProvider(
      apiKey,
      process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
    );
  }

  return null;
}

export function embeddingsConfigured(): boolean {
  return getEmbeddingProvider() !== null;
}

/**
 * Embeds many texts, batched.
 *
 * Batching matters at ingestion: a 200-page PDF is a few hundred chunks, which
 * is a few hundred HTTP requests if issued one at a time.
 */
export async function embedAll(texts: string[]): Promise<number[][]> {
  const provider = getEmbeddingProvider();
  if (!provider) {
    throw new Error(
      "No embedding provider configured. Set OPENAI_API_KEY in the environment.",
    );
  }

  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embedded = await provider.embed(batch);

    if (embedded.length !== batch.length) {
      throw new Error(
        `Embedding provider returned ${embedded.length} vectors for ${batch.length} inputs.`,
      );
    }
    for (const vector of embedded) {
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding provider returned ${vector.length} dimensions; the schema expects ${EMBEDDING_DIMENSIONS}.`,
        );
      }
    }

    vectors.push(...embedded);
  }

  return vectors;
}

/** Embeds a single query. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedAll([text]);
  return vector;
}
