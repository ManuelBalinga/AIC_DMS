# Memory module

What the Ask module remembers between questions.

Before this existed, Ask was stateless: a question went out, an answer streamed
back, and nothing survived the request. Follow-ups were impossible because there
was nothing to follow up on.

```
question → resume thread → load window → resolve follow-up → retrieve
         → generate → store turn + citations → fold aged turns into summary
```

| File | Responsibility |
| --- | --- |
| `config.ts` | Every tuneable number, and the reasoning for each |
| `queries.ts` | Reads: thread list, one thread, the recent tail |
| `store.ts` | Writes: resume/create, append turns, maintain the summary |
| `context.ts` | The window, the follow-up rewrite, the summariser, the title |
| `actions.ts` | Form-driven rename and delete |

## The three kinds of memory

| Kind | What it is | Where |
| --- | --- | --- |
| Working | Recent turns replayed with each question | `conversation_messages`, windowed by `buildHistoryWindow` |
| Long-term | A rolling summary of turns that aged out | `conversations.summary` |
| Semantic | Knowledge the model does not hold — documents and accessible group messages | `document_chunks`, `chat_messages` and pgvector, in the RAG module |

The third one is not this module's job, and the split matters: retrieval answers
*what is true*, this module answers *what we were talking about*. Confusing them
is how a chat assistant ends up citing its own previous answer as a source.

## Why follow-ups are rewritten before retrieval

Retrieval matches a question against passages by meaning. "What about the fees?"
carries almost no meaning on its own, so a follow-up asked naively retrieves
noise — and the model then answers from noise, fluently.

Passing history to the *generator* does not fix this. By the time generation
starts, the wrong passages have already been chosen. So `resolveQuery` rewrites
the follow-up into a standalone query first, and only that rewritten form is
sent to retrieval. What the person typed is what gets stored and shown; the
rewrite is stored alongside it as `resolved_query`, because a retrieval that
comes back empty is almost always a rewrite that went wrong, and that column is
the evidence.

The rewrite runs on Haiku rather than the answering model: it is a short rewrite
on a short input sitting in front of an answer somebody is waiting for.

## Why replayed answers have their citations stripped

A stored answer contains `[3]`, which referred to the third passage retrieved
*for that question*. The next question retrieves its own passages with their own
numbering. Replaying the old text unchanged invites the model to carry a stale
number into a new answer, where it points at the wrong document — and a citation
that looks right and is not is worse than no citation at all.

## Why threads are owner-only

`conversations` and its two child tables have no administrator exception. A
document grant does not include another person's private Ask history. Questions
are frequently more revealing than
the documents they are about.

## On read/write volume

An AI feature reads and writes far more per interaction than a CRUD screen: one
question touches the conversation row, the message rows, the citation rows, and
the whole chunk table through retrieval. Every number in `config.ts` exists to
stop that cost growing with the length of the thread — a turn cap, a character
cap, per-answer truncation on replay, and a summary that absorbs the rest.
Without them, a long thread's twentieth question costs twenty times its first.

## Failure modes it handles

- **No `ANTHROPIC_API_KEY`** — no rewrite and no summaries. Follow-ups fall back
  to prepending the previous *question* (short and on-topic) rather than the
  previous answer (long enough to dominate the embedding and drag retrieval
  toward whatever that answer happened to discuss).
- **An answer that fails mid-stream** — the question is already stored, so the
  thread records what was asked. The replay window then holds two user turns in
  a row, which `buildMessages` merges rather than sending a malformed array.
- **A cited document deleted later** — `message_citations.document_id` is
  `on delete set null` over a snapshot of the title, so the old answer still
  reads correctly and simply stops linking.

## Not done

- Semantic search across past conversations. Threads are found by title in the
  sidebar, which is enough at this scale and would otherwise mean embedding
  every turn.
- Cross-thread memory — nothing learned in one conversation is carried into
  another. That is a product decision as much as a technical one, and it is not
  obviously wanted in a document tool.
- Editing or re-asking an earlier turn.
