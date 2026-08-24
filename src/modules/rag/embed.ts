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
 * Matryoshka-trained models are the way out of that — they are trained so that
 * a shorter prefix is still a usable embedding, so they can be asked for 1536
 * and mean it. That is why `dimensions` is sent on every request.
 */

export type EmbeddingProvider = {
  id: string;
  model: string;
  /** Embeds a batch, returning one vector per input in the same order. */
  embed(texts: string[]): Promise<number[][]>;
};

export type EmbeddingFailure = { ok: false; error: string };

/* -------------------------------------------------------------------------- */
/* OpenAI-compatible embeddings                                               */
/* -------------------------------------------------------------------------- */

/**
 * One request shape covers every provider worth considering here.
 *
 * OpenAI's `/v1/embeddings` contract has been copied by effectively everyone —
 * Ollama, NVIDIA, OpenRouter, Together, and the OpenAI-compatible layer Google
 * puts in front of Gemini — so a single function with a configurable base URL
 * supports all of them, and changing provider becomes environment configuration
 * rather than a code change.
 *
 * Called over `fetch` rather than through the `openai` package: this is one
 * endpoint with a stable request shape, and a whole SDK for it would be the
 * heaviest dependency in the project.
 */
function openAiCompatibleProvider(options: {
  id: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  sendDimensions: boolean;
}): EmbeddingProvider {
  const { id, baseUrl, apiKey, model, sendDimensions } = options;
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/embeddings`;

  return {
    id,
    model,
    async embed(texts) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A local Ollama needs no key at all. Sending `Bearer undefined`
          // would be worse than sending nothing, so the header is omitted
          // rather than filled in with a placeholder.
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          input: texts,
          // Escape hatch for providers that reject unknown fields outright
          // rather than ignoring them. Omitting it is only safe when the
          // model's native width is already 1536 — the guard in `embedAll` is
          // what catches the case where it is not.
          ...(sendDimensions ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `Embedding request to ${id} failed (${response.status}): ${detail.slice(0, 300)}`,
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

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

/**
 * The configured provider, or null when embeddings are not set up.
 *
 * Null rather than a thrown error: the platform is fully usable without RAG,
 * and an unconfigured key should degrade AI search rather than break uploads.
 * Every branch below returns null on a missing requirement for the same reason
 * — a half-configured provider must read as "off", not as "broken".
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const provider = (process.env.EMBEDDING_PROVIDER ?? "openai").trim();
  const model = process.env.EMBEDDING_MODEL?.trim();
  const sendDimensions = process.env.EMBEDDING_OMIT_DIMENSIONS?.trim() !== "true";

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return null;
    return openAiCompatibleProvider({
      id: "openai",
      baseUrl: process.env.EMBEDDING_BASE_URL?.trim() || "https://api.openai.com/v1",
      apiKey,
      model: model || "text-embedding-3-small",
      sendDimensions,
    });
  }

  // A local Ollama: no API key, nothing leaving the machine, and no per-token
  // cost — the combination that answers the privacy question and the budget
  // question at once. It needs a Matryoshka model to reach 1536, which
  // qwen3-embedding is: 2560 native at 4b, 4096 at 8b, and truncating to 1536
  // on request.
  if (provider === "ollama") {
    return openAiCompatibleProvider({
      id: "ollama",
      baseUrl: process.env.EMBEDDING_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
      apiKey: process.env.EMBEDDING_API_KEY?.trim() || null,
      model: model || "qwen3-embedding:4b",
      sendDimensions,
    });
  }

  // Anything else speaking the same dialect. The base URL and model are
  // required here because there is no sensible default for "some other vendor".
  if (provider === "openai-compatible") {
    const baseUrl = process.env.EMBEDDING_BASE_URL?.trim();
    if (!baseUrl || !model) return null;
    return openAiCompatibleProvider({
      id: "openai-compatible",
      baseUrl,
      apiKey:
        process.env.EMBEDDING_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim() ||
        null,
      model,
      sendDimensions,
    });
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
      "No embedding provider configured. Set EMBEDDING_PROVIDER to one of " +
        "openai, ollama or openai-compatible, along with the key, base URL and " +
        "model that provider needs.",
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
        // Worth being specific: this is the failure a provider swap produces,
        // and the fix is either a Matryoshka model that honours `dimensions`
        // or a schema migration widening the column. Storing a short vector is
        // not an option — pgvector would reject it anyway, and later.
        throw new Error(
          `Embedding provider ${provider.id} (${provider.model}) returned ` +
            `${vector.length} dimensions; the schema expects ${EMBEDDING_DIMENSIONS}. ` +
            `Use a model that supports a 'dimensions' parameter, or migrate the ` +
            `vector(${EMBEDDING_DIMENSIONS}) column and re-index every document.`,
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
