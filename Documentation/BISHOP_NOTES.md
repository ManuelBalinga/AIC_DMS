# Bishop's recommendations — notes and status

Captured from meeting notes of **17–18 August 2026** ("Internal tool development
ideas", "AI memory application insights", "Database learning reflections"), plus
the earlier "Database migration to Supabase" (5 August).

This file is the tracker: what he recommended, what has been built in response,
and what is still open. Everything marked **Done** is in the codebase now, with
a pointer to where.

---

## 1. Memory in AI applications

> *"Look into how memory in AI applications works. Look into vector databases.
> Look into primary kinds of memory. When I'm chatting, how is session history
> saved?"*

He also flagged the reason it matters: **AI applications read and write far more
per interaction than traditional apps do.** One question touches the thread, the
turns, the citations, and the entire chunk table via retrieval.

### The three kinds of memory, and where each one lives here

| Kind | What it is | Where it lives in this codebase |
| --- | --- | --- |
| **Working memory** | The recent turns replayed to the model with each question | `conversation_messages`, windowed by `buildHistoryWindow` |
| **Long-term / episodic** | A rolling summary of turns that have aged out | `conversations.summary`, written by `summariseOlderTurns` |
| **Semantic / retrieval** | Knowledge the model does not hold — the documents | `document_chunks` + pgvector, the pre-existing RAG module |

Status: **Done.** Migration `supabase/migrations/0005_memory.sql`, module
`src/modules/memory/`.

### How session history is saved, concretely

Before this change, Ask was **stateless**: a question went out, an answer
streamed back, and nothing survived the request. There was no follow-up because
there was nothing to follow up on.

Now, per question, in this order:

1. Resume the thread (or create one, titled from the question).
2. Load the recent turns — *before* storing the new question, so a question
   never appears in its own context.
3. Rewrite the question into a standalone query if it is a follow-up.
4. Store the question. This happens before generation, so a thread whose answer
   fails still records what was asked.
5. Retrieve, generate, stream.
6. Store the answer and its citations.
7. Fold anything that aged out of the window into the summary.

### The part that was easiest to get wrong

Retrieval matches a question against passages **by meaning**. "What about the
fees?" has almost no meaning on its own, so a follow-up asked naively retrieves
noise — and the model then answers from noise, fluently.

Passing history to the *generator* does not fix this. By the time the generator
sees anything, the wrong passages have already been chosen. So follow-ups are
rewritten into standalone queries *before* retrieval (`resolveQuery` in
`src/modules/memory/context.ts`), using Haiku — cheap and fast, because it sits
in front of an answer someone is waiting for.

The other trap: prior answers are replayed **with their `[3]` citations
stripped**. Those numbers referred to passages retrieved for an earlier
question; this question has its own numbering. A stale number that still looks
like a citation points at the wrong document, which is worse than no citation.

### On read/write volume

The numbers in `src/modules/memory/config.ts` all exist to stop cost growing
with thread length: a turn cap, a character cap, per-answer truncation on
replay, and a summary that folds the rest. Without them a long thread's twentieth
question costs twenty times its first.

---

## 2. Portable, modular schemas

> *"Tell the AI that when it's developing a schema, it should port/pull records
> in a modular or dynamic way from one database to the next — like from Neon to
> Supabase, or to Clerk. A small migration script can handle the transfer."*

Status: **Done.** See [`db/README.md`](../db/README.md).

- `db/portable-schema.sql` — the whole schema with no provider-specific
  dependency. Runs on Neon, plain Postgres, or Supabase.
- `scripts/db-export.mjs` — every record out of the live project, as JSONL.
- `scripts/db-import.mjs` — that export into any Postgres, or another Supabase.

The core idea is that four things normally lock a schema to its provider —
`auth.users`, `auth.uid()`, `storage.*`, and the `authenticated` role — and each
is isolated to one place. The important one is `app.current_user_id()`: every
RLS policy asks "who is calling?", that is the only question providers answer
differently, and absorbing it into one function means the ~20 policies below it
are identical across providers. Without that, a provider move means rewriting
every policy, which is where permission bugs come from.

**Honest cost:** `db/portable-schema.sql` and `supabase/migrations/` describe the
same tables and can drift. They are reconciled by hand. A portable schema
discovered to be three migrations stale at the moment you need it is not a
portable schema — so it gets updated in the same commit as any migration.

---

## 3. Neon

> *"Look into Supabase alternatives, Clerk, and especially Neon — Bishop likes
> Neon. Generous features for basic projects, and it can be managed by CLI
> directly from the coding environment."*

Status: **Considered and declined, 19 August — Manuel's decision.** Staying on
Supabase for database, auth and storage. Neon remains a proven exit rather than
a starting point; the move is three commands, in `db/README.md`.

The reasoning is recorded in `PROJECT_STATUS.html` §4 and in
`Documentation/DATABASE_DECISION.md`. In short: Neon is only a database, so
adopting it means Neon + Clerk + an object store replacing one vendor, and
replacing the two subsystems that are already finished. Both are PostgreSQL, so
nothing Bishop pointed at — Postgres, pgvector — is given up. And the substance
of his advice was portability, which is built rather than deferred.

Two things worth knowing before switching:

- **Neon has no object storage.** Document bytes currently live in Supabase
  Storage. A full move needs a separate answer for files (S3, R2, or keeping
  Supabase Storage on its own).
- **Neon has no auth.** Supabase Auth handles sign-in, invitations, and password
  reset today. A Neon move needs Clerk or equivalent alongside it.

Which suggests the realistic shape is **Neon for Postgres + Clerk for auth +
something for files**, rather than a one-for-one swap. That is a real decision,
not a migration — worth taking deliberately rather than as a side effect.
`app_users.auth_provider` / `auth_subject` exist so identities survive it:
a user gets a new Clerk subject written against their existing row and keeps
every document they own.

Neon's CLI point is right and useful — `neonctl connection-string` pipes
straight into `psql`, so the whole migration runs from the terminal.

---

## 4. pgvector

> *"PGVector recommended for vector storage. Supabase preferred partly for this
> reason."*

Status: **Already done**, and it predates the recommendation — good sign the
call was right. `document_chunks.embedding` is `vector(1536)` with an HNSW
index, hybrid semantic + keyword retrieval in `src/modules/rag/retrieve.ts`.

The reasoning is written up in `src/modules/rag/README.md`: a separate vector
store would mean a second permission model, and a second permission model is
exactly the risk this design avoids. Chunk permissions are inherited from the
document through RLS, so retrieval cannot leak a restricted document by
forgetting a `where` clause.

Neon supports pgvector too, so this does not constrain the provider choice.

---

## 5. Auth: the five or six things every app needs

> *"Sign up, sign in, forgot password, session management. Clerk and Supabase
> handle this automatically. Forgot-password flow still needs work — currently
> requires an admin to reset via Supabase directly."*

Status: **Built, needs verifying against the note.** The app has
`/auth/forgot-password`, `/auth/set-password`, and `/auth/callback`, so the
self-service reset exists in code. The note may predate it, or the Supabase
project may not have SMTP configured — in which case the emails are simply not
being delivered, which would look exactly like "needs an admin".

**Open action:** send a reset to a real address on the live project and confirm
the mail arrives. If it does not, it is Supabase's SMTP settings, not the app.

No sign-up flow, deliberately: this is an internal tool, invitation-only, per
the 17 August note.

---

## 6. Fundamentals to study

> *"CRUD, but mostly focus on the AI/RAG system. DML, DDL, DCL. AI handles
> syntax now — the next layer is systems thinking: breaking products down into
> core components."*

Not a code change, but worth naming where each appears in this repo, since it is
all here in working form:

- **DDL** (structure) — `supabase/migrations/*.sql`, `db/portable-schema.sql`
- **DML** (records) — every query in `src/modules/*/queries.ts` and
  `actions.ts`, and the generated `db/export/import.sql`
- **DCL** (permission) — the `grant` statements at the foot of
  `db/portable-schema.sql`, and the RLS policies, which are the interesting part

RLS is where this platform's security actually lives: permissions are enforced
by database policies, not application code. `src/modules/rag/README.md`
explains why retrieval contains no permission filter at all — the database
removes passages the asker cannot read before the code sees them.

---

## Still open

| # | Item | Waiting on |
| --- | --- | --- |
| 1 | Sending AIC documents to a third-party model for answering | **Bishop** — privacy call, raised in the plan's §9 and still unanswered |
| 2 | Real document samples to confirm the parser set | **Bishop** — which formats actually circulate on WhatsApp today |
| 3 | Confirm the password-reset email actually sends | Testing against the live project |
| 4 | Object storage and auth answers for a Neon move | The Neon account existing |
| 5 | OCR for scanned documents | Not started; needed if the real samples turn out to be photos |
| 6 | Durable ingestion queue | Explicitly deferred on 5 Aug ("no durable queue") — ingestion runs in the upload request |
