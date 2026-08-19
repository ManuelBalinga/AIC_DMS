# The backend decision

You are choosing a backend. This is what the choice actually involves, what it
costs, and what I need from you either way.

Written against the Master Project Plan §7 (Recommended Technical Architecture)
and §14 (Security Model).

## What the platform needs from a backend

Four separate things, which providers bundle differently. Most of the confusion
in this decision comes from treating them as one:

| Need | What it does | Currently |
| --- | --- | --- |
| **Postgres** | Users, documents, metadata, permissions, chunks, vectors | Supabase Postgres |
| **Auth** | Sign-in, invitations, password reset, sessions | Supabase Auth |
| **Object storage** | The document bytes themselves | Supabase Storage, private bucket |
| **Row Level Security** | The permission model — see below | Postgres RLS |

The fourth is not a commodity. **Permissions in this platform are enforced by
the database, not by application code.** Retrieval contains no permission
filter at all; `document_chunks` has an RLS policy calling `can_read_document`,
so Postgres removes passages the asker cannot read before the code ever sees
them. A future change cannot leak a restricted document by forgetting a `where`
clause, because the clause was never in that layer to forget.

Any backend that cannot enforce permissions inside Postgres moves that
responsibility into application code, where it has to be got right in every
query, forever. That is the single most consequential property to preserve.

## The options

### Stay on Supabase

**Cost:** nothing. It is already built and the migrations are written.

All four needs in one product, RLS native, pgvector included, and a free tier
that covers a beta comfortably. The reason to move is not that Supabase is
inadequate — it is not — but vendor concentration.

### Neon + Clerk + object storage

The shape Bishop's recommendation points at, and the one people usually
underestimate.

Neon is a Postgres host. It is a good one — real branching, generous free tier,
CLI-driven as Bishop said. But it is *only* Postgres:

- **No auth.** Clerk or equivalent, as a separate product and bill.
- **No object storage.** S3, Cloudflare R2, or keeping Supabase Storage alone.
- **RLS still works** — it is a Postgres feature, not a Supabase one — but
  `auth.uid()` does not exist, so the app must set the caller's identity per
  transaction. `db/portable-schema.sql` already does this through
  `app.current_user_id()`; that adapter is the only file that differs.

**Cost:** roughly two to three days. Wire Clerk, wire a storage provider, run
the portable schema, run the import, re-verify permissions end to end.

**Worth knowing:** three providers means three bills, three status pages, three
outage modes. For an internal tool at AIC's size, that is a real ongoing tax.

### Self-hosted Postgres

Full control, no vendor. You operate backups, upgrades, availability, and
build auth yourself. **I would not recommend this** — it converts a product
decision into an operations commitment, and nothing in the plan requires it.

## Recommendation

**Stand up Supabase now and decide later.** Not because it is the permanent
answer, but because of what is actually blocking the project.

Nothing on the status page has ever run against a real Postgres. Every "Built"
is code-complete and unverified. The fastest route to knowing whether this
platform works is one Supabase project and forty minutes — five migrations, a
`.env.local`, and `npm run verify:rls`. Until that happens, more building adds
unverified code on top of unverified code.

The portability work means this is genuinely reversible. Moving to Neon later
costs the two to three days above whether you do it now or in two months, and
doing it now costs those days *before* you know the platform works at all.

The one thing that would change my recommendation: if AIC has a policy against
storing company documents with a US-hosted vendor, that outranks everything
here and should be settled first, because it also decides the LLM question.

## What I need from you

**To unblock verification** — the four Phase 3 items and every unproven claim:

1. **A Supabase project** (or Neon + Clerk, if you have decided). Then the
   values for `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   `Documentation/DEPLOYMENT.md` has the full walkthrough.
   *Send credentials through something private — not a git commit, not a chat
   log. The service-role key bypasses every permission rule in the platform.*

2. **Representative AIC documents** — five or six real files of the kinds that
   actually circulate. The parsers were written against the document types the
   plan names, not against real files. This is what turns "supports PDF/DOCX/
   XLSX/PPTX" from a claim into a tested one, and it is the item Bishop has been
   asked for twice.

**Decisions only you or Bishop can make:**

3. **The LLM privacy question.** Answering questions sends document text to
   Anthropic. It is the only point where AIC content leaves your control, and
   it has been open since the first plan. Without an answer the platform still
   runs — Ask degrades to keyword search — but the AI half of the product is
   the half Bishop is most interested in.

4. **The email domain** for team accounts, and whether invitations should be
   restricted to it.

5. **Two roles or three.** The plan says administrator / document owner / team
   member. Your 27 July student-screen notes described students, tutors and
   admin. If this platform is also meant to serve the training centre,
   `user_role` needs a third value now — cheap today, a migration later.

**Optional, unblocks nothing:**

6. A platform name, if you want to move off "AIC Documents" before the demo.
   It is 13 occurrences in code today.

## What I can keep building without any of it

Phase 4 and Phase 5 are largely backend-agnostic, since they reuse the chunks
and embeddings ingestion already produces. Available now, roughly in value
order:

- **Re-ranking retrieved passages** before generation — the clearest remaining
  win for answer quality.
- **Document comparison and information extraction** (Phase 4).
- **Indexing-status dashboard and failed-ingestion monitoring** (Phase 5) —
  which becomes genuinely useful the moment real documents start failing.
- **Audit logging** (Phase 5, §14) — worth adding before real documents go in,
  since it cannot reconstruct history retroactively.
- **Departments and permission groups** (Phase 5) — though these commit to
  schema decisions, so the role question above should be settled first.

I would rather do those *after* a database exists than before. Say the word if
you would prefer otherwise.
