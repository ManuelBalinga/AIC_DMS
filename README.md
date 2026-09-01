# AIC Internal Document Platform

A modular internal document platform for the Accra Innovation Center. It replaces
WhatsApp-based document sharing with secure storage, controlled team access, and
an AI/RAG layer for querying company documents.

Full scope in [`Documentation/`](./Documentation) — including a
[deployment guide](./Documentation/DEPLOYMENT.md) and a
[demo script](./Documentation/DEMO_SCRIPT.md). Where accounts are stored, why
Supabase rather than Neon, and the full setup walkthrough are in
[the database decision](./Documentation/DATABASE_DECISION.md). Live delivery status in
[`PROJECT_STATUS.html`](./PROJECT_STATUS.html) — open it in a browser.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, TypeScript, Tailwind v4) |
| Database | Supabase Postgres, with `pgvector` enabled for Week 2 |
| Auth | Supabase Auth, invitation-only (no public sign-up) |
| File storage | Supabase Storage, private bucket, server-signed URLs only |
| Permissions | Postgres Row Level Security |
| Retrieval | `pgvector` (HNSW) for semantic search and Postgres full-text search over accessible documents and group conversations; direct messages are excluded |
| Generation | Configurable answer provider; Claude Opus 5 is the default |
| Conversation memory | Postgres — threads, turns and citations, owner-only under RLS |
| Team messaging | Postgres — threads, participants and messages, participant-only under RLS |

**Why RLS matters here:** per-document permissions are enforced by database
policies, not by application code. Week 2's RAG retrieval reads
`document_chunks`, whose policy calls `can_read_document` — so a user can never
retrieve an answer grounded in a document they cannot open, even if the
retrieval code forgets to filter.

## Tests

```bash
npm test
```

176 unit tests on `node:test`, with no test-framework dependency: Node strips
the TypeScript natively, and a small resolve hook in `tests/` teaches it the
`@/*` alias so the tests exercise the real source files rather than a copy.

They cover the logic where a bug is silent — chunking (including that a chunk
never spans two pages, which is what makes a page citation honest), memory
windowing and citation stripping, filename sanitisation, and the migration
script's SQL escaping. Database policy logic is covered locally by
`npm run verify:rls:local`; `npm run verify:rls` remains the authority against
the development Supabase project.

## Messaging, and what Ask may quote

Team members message each other on the platform rather than on WhatsApp, which
is the whole point of the product. Threads are readable only by their
participants — **with no administrator exception**, the same reasoning that took
document reading away from administrators in migration 0007: managing access and
reading contents are different powers, and reading a colleague's private messages
is further still.

Ask retrieves from group messages alongside documents, scoped by the same kind of
RLS. Direct messages are deliberately never indexed or retrieved. Documents are
ranked first and cited differently, because "I think we said 500" and the
published fee schedule are different claims. See
[`src/modules/chat/README.md`](./src/modules/chat/README.md).

## Conversation memory

Ask is a thread, not a one-shot box. Each question is answered with the recent
turns of its conversation replayed as context, and a follow-up is rewritten into
a standalone query *before* retrieval runs — "what about the fees?" carries
almost no meaning on its own, so retrieving on it directly returns noise, and
the model then answers from noise. See
[`src/modules/memory/README.md`](./src/modules/memory/README.md).

Threads are owner-only, with no administrator exception. Access to a document
does not grant access to another person's private Ask history.

## Moving to another Postgres provider

The schema is not locked to Supabase. Four things normally do the locking —
`auth.users`, `auth.uid()`, `storage.*`, and the `authenticated` role — and each
is isolated to one place, so the RLS policies are identical across providers.

```bash
node scripts/db-export.mjs                                    # records out
node scripts/db-import.mjs --from db/export --target neon     # SQL for the target
psql "$NEON_DATABASE_URL" -f db/portable-schema.sql
psql "$NEON_DATABASE_URL" -f db/export/import.sql
```

What does *not* move — document bytes, passwords, and why Neon needs a separate
answer for both — is in [`db/README.md`](./db/README.md).

## Setup

### 1. Create the Supabase project

Create a project at [supabase.com](https://supabase.com), add `SUPABASE_DB_URL`
to `.env.local` (Project Settings — Database — Connection string), then apply
the schema:

```bash
npm run db:migrate          # or --dry to see what would run
```

That applies the migrations below in order, once each, tracked in an
`applied_migrations` ledger. To run them by hand instead, paste them into the
SQL Editor in this order:

1. `supabase/migrations/0001_init.sql` — schema, helper functions, RLS policies
2. `supabase/migrations/0002_storage.sql` — private `documents` bucket
3. `supabase/migrations/0003_organization.sql` — tags and keyword search
4. `supabase/migrations/0004_rag.sql` — retrieval functions and the vector index
5. `supabase/migrations/0005_memory.sql` — conversation threads, turns and citations
6. `supabase/migrations/0006_intelligence.sql` — summaries, tag suggestions, related documents
7. `supabase/migrations/0007_roles_and_comments.sql` — document roles, comments, deactivation
8. `supabase/migrations/0008_chat_and_context.sql` — team messaging and message retrieval
9. `supabase/migrations/0009_direct_messages_are_never_indexed.sql` — excludes DMs from Ask
10. `supabase/migrations/0010_security_hardening.sql` — private policy helpers, least-privilege Data API/RPC grants and foreign-key indexes
11. `supabase/migrations/0011_message_collaboration.sql` — replies, mentions, reactions, versioned edits and retraction
12. `supabase/migrations/0012_teams_foundation.sql` — durable Direct/Team identity, open/closed visibility and governed membership
13. `supabase/migrations/0013_team_document_access.sql` — membership-derived document grants for Teams
14. `supabase/migrations/0014_permission_aware_document_references.sql` — governed message references with title-free locked cards
15. `supabase/migrations/0015_thread_document_promotion.sql` — conversation snapshots as governed documents plus immutable storage binding
16. `supabase/migrations/0016_chat_realtime_notifications.sql` — live chat invalidation, quiet mention/reply notifications and race-safe read receipts
17. `supabase/migrations/0017_offline_document_leases.sql` — owner-vetoed, auditable 30-day offline leases and reconnect validation

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in from **Project Settings → API**. `SUPABASE_SERVICE_ROLE_KEY` bypasses
RLS entirely — it must never be prefixed `NEXT_PUBLIC_` or committed.

The AI keys at the bottom of `.env.example` are **optional**. Without them the
document platform works normally: uploads are stored but not indexed, and Ask
falls back to keyword search. That is the right failure mode while the question
of sending AIC documents to a third-party model is still open.

### 3. Point Supabase Auth at the app

In **Authentication → URL Configuration**:

- Site URL: `http://localhost:3000`
- Redirect URLs: add `http://localhost:3000/auth/callback`

In **Authentication → Providers → Email**, disable *Enable sign-ups* so the
no-public-sign-up rule is enforced by the provider as well as by the app.

### 4. Create the first administrator

The platform has no public sign-up, and inviting anybody requires an
administrator — so the first account has to come from outside the app:

```bash
npm run bootstrap:admin -- you@aic.example
```

This creates the auth user, verifies the profile row was actually written by the
`on_auth_user_created` trigger (catching a half-applied migration `0001` now
rather than days later), and sets the role to `administrator`. It prints a
generated password once; change it from the Account page after signing in, or
pass `--password 'your-own'` instead.

Safe to re-run — an address that already has an account is promoted, not
duplicated. Every account after this one is created by invitation from the Team
page.

### 5. Run

```bash
npm run dev
```

Sign in at `http://localhost:3000/login`. Everything else is reachable from
there; every route except the login and invitation pages requires a session.

## Project structure

```
src/
  app/
    (app)/               Authenticated shell
      dashboard/         Document list, search, tag filters, upload
      documents/[id]/    Detail, preview, edit, sharing, indexing, delete
      ask/               AI question answering with citations
      account/           Own name and password
      admin/team/        Invitations and roles (administrators only)
    auth/                Invitation callback, password setup, recovery
    api/documents/       Signed upload, metadata registration and download
    api/rag/ask/         Streaming answer endpoint
  modules/               Feature modules (plan §7)
    auth/                Session helpers and guards
    users/               Team roster and invitations
    documents/           Document queries, actions, format rules
    access/              Per-document grants
    comments/            Document comments and replies
    search/              Full-text search inside document content
    rag/                 Extraction, chunking, embedding, retrieval, answers
    memory/              Ask threads, replay windows and rolling summaries
    intelligence/        Summaries, tag suggestions, related documents
    chat/                Team messages and group-message retrieval
  lib/
    supabase/            client / server / admin clients
    types/               Database types
  components/ui/         Shared primitives
scripts/                 Operational scripts (RLS verification)
supabase/migrations/     SQL migrations
```

Modules own their own queries and actions. Pages compose modules; modules do not
import from pages. Adding a future capability (plan §13) means adding a folder
under `src/modules`, not editing the document module.

## Security model

- **Every route is private by default.** `src/proxy.ts` redirects unauthenticated
  requests to `/login`; the allowlist of public paths is at the top of that file.
- **Reads and writes run as the signed-in user.** `lib/supabase/server.ts` uses
  the anon key, so RLS applies to every query.
- **The service-role client is confined to privileged operations** such as auth
  administration, signed storage operations, ingestion and operational scripts.
  Each user-facing call site checks the caller before using it.
- **The storage bucket is private and has no broad client-facing policies.** The
  browser uploads only through a short-lived signed URL minted after server-side
  validation; downloads pass through a permission check before receiving a
  60-second signed URL.
- **Missing and forbidden are indistinguishable.** An unauthorised document
  returns 404, so the API cannot be used to probe for document existence.
- **AI retrieval inherits document permissions from the database.** The two
  retrieval functions are `SECURITY INVOKER` over `document_chunks`, so the
  permission filter is applied by Postgres, not by retrieval code that could
  forget it. `npm run verify:rls` asserts this from a second, unauthorised
  account.

## Working from Claude Code on the web

The repo is set up to be useful from a phone with no configuration at all.
`.env.local` is gitignored, so a fresh cloud checkout has no secrets — and
does not need any for most work:

```bash
npm install
npm run build      # passes with no env file
npm run typecheck
npm run lint
```

What **does** need configuration is running the dev server and looking at pages:
every route reads Supabase at request time, so without env vars the pages return
500s. To bring a cloud session up to the same state as the local machine, paste:

```bash
cp .env.example .env.local
```

then fill in the four Supabase values. Nothing is committed — `.env.local`
stays ignored in the cloud exactly as it does locally.

For a fresh checkout, placeholder values are enough to let the app build. Pages
that query Supabase require real development-project values at runtime.

## Agent skills

Two Supabase-maintained skills are used by AI coding tools working in this repo:
`supabase` (products, client libraries, debugging) and
`supabase-postgres-best-practices` (schema, RLS, indexes, migrations). The second
is the relevant one here, since this platform puts its whole permission model in
RLS policies.

They are installed, not authored, so the content is gitignored and
`skills-lock.json` pins the source and hash. After a fresh clone:

```bash
npx skills add supabase/agent-skills
```

Skills run with full agent permissions, so review a diff to `skills-lock.json`
the way you would review a new dependency — the hash changing means the
upstream instructions changed.

## Scripts

```bash
npm run dev         # development server
npm run build       # production build
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # 176 unit tests
npm run db:migrate  # apply pending migrations in order
npm run verify:rls:local # destructive throwaway-Postgres policy suite
npm run verify:rls  # permission-boundary test against a live project
npm run verify:embeddings # embedding provider smoke test
npm run verify:answering  # answer provider smoke test
npm run bootstrap:admin -- <email>   # create the first administrator
npm run db:export   # dump all records to portable JSONL
npm run db:import   # load an export into another Postgres provider
```

`verify:rls` creates two throwaway users, confirms one cannot read the other's
document, its chunks or its stored bytes, and deletes them again. Run it against
a **development** project.

## Open questions for Bishop

1. **Sample documents.** The accepted list in
   `src/modules/documents/constants.ts` and the parsers in
   `src/modules/rag/extract.ts` were written against the stated document types,
   not against real files. Real samples are what turn that from a guess into a
   tested claim.
2. **The AI provider, on privacy grounds.** External answer and embedding
   providers receive relevant passages or chunks. Provider choice and account
   ownership determine where AIC content leaves AIC's control.
3. **The email domain** team accounts will use.
4. **The platform name.** The working product name remains “AIC Documents.”
