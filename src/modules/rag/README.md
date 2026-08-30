# RAG module

The intelligence layer over the document platform. Pipeline, in order:

```
document → extract → chunk → contextualise → embed → store → retrieve → generate → cite
```

| File | Responsibility |
| --- | --- |
| `config.ts` | Every tuneable number, and the reasoning for each |
| `extract.ts` | Text out of PDF / DOCX / XLSX / PPTX / plain text, with page numbers where the format has them |
| `chunk.ts` | Boundary-respecting, overlapping chunks |
| `contextualise.ts` | Situates a chunk in its document before embedding |
| `embed.ts` | Embedding provider behind an interface |
| `ingest.ts` | Orchestration and the `documents.index_status` lifecycle |
| `retrieve.ts` | Hybrid semantic + keyword retrieval |
| `answer.ts` | Grounded generation with numbered citations |

Conversation state is deliberately not in this module — see
[`../memory/README.md`](../memory/README.md). The split is that retrieval
answers *what is true* and memory answers *what we were talking about*;
collapsing the two is how an assistant ends up citing its own previous answer as
a source. The one place they meet is that a follow-up is rewritten into a
standalone query by the memory module **before** `retrieve.ts` sees it, because
by the time generation starts the wrong passages have already been chosen.

## Why permissions are not in this code

`retrieve.ts` contains no permission filter, and that is deliberate. Both
retrieval RPCs are `SECURITY INVOKER` functions over `document_chunks`, whose
RLS policy calls `can_read_document`. The database removes passages from
documents the asker cannot open *before* this module sees them.

This satisfies plan §6.4 steps 2–3 structurally rather than by convention: a
future change to retrieval cannot leak a restricted document by forgetting a
`where` clause, because the clause was never in this layer to forget.

The one place that does run with elevated privilege is `ingest.ts`, which reads
the private storage bucket with the service-role client. That is safe because
ingestion never takes a caller-supplied filter — it indexes exactly one named
document, whole — and its callers check the caller's rights first
(`reindexDocument`). Enforcement lives on the read side.

## Research questions from plan §9, and the answers taken

| Question | Answer, and why |
| --- | --- |
| Which formats initially? | PDF, DOCX, XLSX, PPTX, TXT, MD, CSV. Images are accepted for storage but not indexed — that needs OCR. **Still needs Bishop's real samples to confirm.** |
| Which parsers? | `unpdf` for PDF (bundles pdf.js, works serverless, gives per-page text so citations can name a page). `mammoth` for DOCX. A small OOXML reader over `fflate` for XLSX/PPTX rather than a third heavy dependency. |
| Chunking strategy? | ~3200 characters with 400 of overlap, split on paragraph → sentence → hard boundaries, never spanning a page. Characters not tokens: tokenising during ingestion would mean a network round trip per document, and ~4 chars/token is close enough for prose. |
| pgvector or a dedicated vector database? | pgvector, with an HNSW index. At AIC's scale a separate vector store would add an operational component and a second permission model for no retrieval benefit — and the second permission model is exactly the risk this design avoids. |
| Embedding model? | `text-embedding-3-small` by default: its native 1536 width matches the column the schema already commits to. `EMBEDDING_PROVIDER` also accepts `ollama` (local, free, no key, nothing leaving the machine) and `openai-compatible` (any other vendor speaking the same shape). All three go through one request function, so the choice is configuration rather than code. The width is the part that is not free to change — a provider that cannot emit 1536 needs a schema migration *and* a full re-index, so prefer a Matryoshka model that honours `dimensions`. See `Documentation/DEPLOYMENT.md`. |
| Which LLM? | A configurable answer provider; Claude Opus 5 is the default. **Open for Bishop on privacy grounds** — external answer and embedding providers receive selected AIC content. |
| How are citations represented? | The model cites `[n]` against numbered passages; the UI turns each into a link to the source document and page. Sources are also listed under the answer with an excerpt. |
| Behaviour with no answer in the corpus? | Say so and name what is missing. The system prompt forbids falling back on general knowledge, and a question with no retrieved passages short-circuits before generation. |

## Failure modes it handles

- **No API keys** — uploads still work, indexing reports as unconfigured, and
  Ask degrades to keyword search rather than erroring.
- **A format with no parser, or a scan with no text layer** — the document is
  marked `failed` with the reason shown on its page, next to a **Re-index**
  button.
- **A model refusal** — the Anthropic provider can occasionally decline benign
  requests, so it carries a server-side fallback. Any refusal that survives its
  provider handling is reported rather than shown as an empty answer.

## Which model can change, and which cannot

Worth keeping straight, because the two look alike and behave nothing alike:

- **The answering model is free.** `ANSWER_MODEL` is an environment variable
  (default `claude-opus-5`). Nothing it produces is stored — a question goes
  out, an answer comes back — so a cheaper tier in development and the default
  in production costs nothing and needs no re-index. Run Haiku while iterating.
- **The embedding model is not.** Every vector in `document_chunks` was produced
  by one model. A different one puts vectors in a different space, so the stored
  ones stop meaning anything and the whole corpus must be re-indexed; a
  different native width needs a schema migration on top, since the column is
  pinned to `vector(1536)`.

Which is why the vendor question wants settling before a real corpus is indexed,
and why the tier question does not.

## Contextual embeddings

Chunking destroys the thing that made each passage meaningful: its place in the
whole document. A chunk reading

> The fee is GHS 500 per participant, payable before the first session.

names neither the programme nor the year, so its embedding lands nowhere near
"what does the i363 programme cost in 2026?" — and the passage holding the
answer becomes the one passage retrieval cannot find. The keyword arm does not
rescue it either: the question and the passage share almost no words.

`contextualise.ts` fixes this by embedding each chunk together with a short
header naming its document, tags, summary and page. Two properties matter:

1. **The header never reaches `content`.** It lives in its own column
   (`document_chunks.context_header`) and is stored beside the passage, never
   inside it, because `content` is what a citation quotes. A citation that
   quoted a preamble this code wrote would be a citation of something the
   document does not say.
2. **It costs no extra model call.** The header is assembled from metadata
   ingestion already produces. The textbook version asks a model to write a
   bespoke sentence per chunk, which multiplies ingestion cost by the chunk
   count — for a 200-page PDF that is not a rounding error.

This is why ingestion now summarises *before* embedding rather than after: the
summary is an input to the header. When there is no summary — no API key, or a
summariser outage — the header degrades to title, tags and page rather than
disappearing. Indexing still requires a configured embedding provider, but it
does not require a summarisation key.

## Retrieval over conversations

Ask also retrieves from team messages (`../chat/README.md`), scoped by the same
kind of RLS that governs documents: you can only be quoted conversations you are
a participant in. Direct messages are excluded outright, whether or not you are
in them — migration `0009` filters both retrieval functions on `is_group`,
because a private word between two colleagues was never meant to be something
Ask could quote back. Documents are ranked first and messages are cited differently,
because "I think we said 500" and the published fee schedule are different
claims and an answer that renders them identically hides the difference.

## Not done

- OCR for scanned documents and images.
- Re-embedding a rewritten follow-up against the *original* phrasing as well, and
  merging both result sets. Worth measuring once real threads exist.
- A durable queue for ingestion; today it runs in the upload request's process.
- Re-ranking retrieved passages before generation. Worth measuring once there
  are enough real documents for retrieval quality to be assessable at all.
