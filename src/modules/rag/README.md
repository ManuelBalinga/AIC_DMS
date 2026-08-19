# RAG module

The intelligence layer over the document platform. Pipeline, in order:

```
document → extract → chunk → embed → store → retrieve → generate → cite
```

| File | Responsibility |
| --- | --- |
| `config.ts` | Every tuneable number, and the reasoning for each |
| `extract.ts` | Text out of PDF / DOCX / XLSX / PPTX / plain text, with page numbers where the format has them |
| `chunk.ts` | Boundary-respecting, overlapping chunks |
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
| Embedding model? | `text-embedding-3-small`. Its native 1536 width matches the column the schema already commits to, and it is cheap enough that re-indexing the whole corpus after a chunking change is not a budget decision. |
| Which LLM? | Claude Opus 5. **Open for Bishop on privacy grounds** — this is the only point at which document content leaves AIC's control. |
| How are citations represented? | The model cites `[n]` against numbered passages; the UI turns each into a link to the source document and page. Sources are also listed under the answer with an excerpt. |
| Behaviour with no answer in the corpus? | Say so and name what is missing. The system prompt forbids falling back on general knowledge, and a question with no retrieved passages short-circuits before generation. |

## Failure modes it handles

- **No API keys** — uploads still work, indexing reports as unconfigured, and
  Ask degrades to keyword search rather than erroring.
- **A format with no parser, or a scan with no text layer** — the document is
  marked `failed` with the reason shown on its page, next to a **Re-index**
  button.
- **A model refusal** — Claude Opus 5's classifiers occasionally decline benign
  requests, so requests carry a server-side fallback. A refusal that survives it
  is reported rather than shown as an empty answer.

## Not done

- OCR for scanned documents and images.
- Re-embedding a rewritten follow-up against the *original* phrasing as well, and
  merging both result sets. Worth measuring once real threads exist.
- A durable queue for ingestion; today it runs in the upload request's process.
- Re-ranking retrieved passages before generation. Worth measuring once there
  are enough real documents for retrieval quality to be assessable at all.
