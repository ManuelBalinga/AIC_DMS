# Where accounts live, and whether Neon is the answer

Written to settle one question before anything is created: **when you make
yourself an administrator, what actually gets stored, and where?**

Short version: Supabase for the beta, and Bishop's portability requirement is
met — but not by Neon, because Neon does not do the part of the job that
accounts need. The reasoning is below, then the step-by-step.

---

## 1. An account is two things, not one

This is the part that makes the Neon question answerable. Creating a user writes
in **two** places:

| | The credential | The record |
| --- | --- | --- |
| What it is | Email, password hash, session tokens, reset tokens | Your id, name, role, and everything you own |
| Who owns it | The auth provider (`auth.users` on Supabase) | **This schema** — `profiles`, or `app_users` in the portable version |
| Portable? | **No.** Hashes are deliberately not exportable | **Yes.** It is ordinary Postgres |
| Size | One row per person | Everything else in the platform |

When you run the bootstrap script, Supabase Auth writes the credential, and the
`on_auth_user_created` trigger immediately writes the record. Two rows, two
owners, joined by the same UUID.

**Why split it at all?** Because password hashing, session rotation, reset
tokens and invitation emails are security-critical, fiddly, and identical for
every application ever written. Handing that to a provider is the right call.
What you should *not* hand over is the part that is genuinely yours — who owns
which document, who granted access to whom. That is why this schema owns
`profiles`/`app_users` rather than storing roles as metadata on the auth user.

## 2. So is this where Neon comes in?

**No — and this is the thing worth being clear about before you build on it.**

Neon is Postgres. Excellent Postgres: serverless, branchable, real `pgvector`,
a good CLI. Bishop is right to like it.

But Neon is *only* a database. It has no auth service. No password hashing, no
session management, no invitation emails, no password reset. It also has no
object storage, so it cannot hold the document files either.

So "store the accounts in Neon" is not a thing that can be done on its own. The
realistic Neon shape is three vendors:

```
Neon (Postgres + pgvector)  +  Clerk (auth)  +  S3/R2 (document files)
```

against today's one:

```
Supabase (Postgres + pgvector + auth + storage)
```

| | Supabase | Neon + Clerk + S3 |
| --- | --- | --- |
| Postgres + pgvector | Yes | Yes |
| Auth, invitations, password reset | Yes, built in | Clerk |
| File storage for documents | Yes, private buckets | S3 / R2 |
| RLS keyed to the signed-in user | `auth.uid()`, native | Works, via JWT + `set_config` |
| Vendors to manage, bill, debug | 1 | 3 |
| Work to switch to it from here | — | Auth rewrite + storage rewrite |

For a three-week internal beta serving maybe a dozen people, three vendors buys
nothing and costs a rewrite of the two subsystems that are already finished.

**Recommendation: Supabase now. Keep Neon as a proven exit, not a starting
point.** If AIC later outgrows Supabase, or wants the database somewhere
specific, the move is a scripted afternoon rather than a rebuild — which is
exactly what the next section is for.

## 3. Bishop's requirement, and how it is actually met

> *Schemas should be built so records can be ported from one database to the
> next — Neon to Supabase, or to Clerk — with a small migration script.*

This is met, and it is worth knowing precisely how far it goes.

**What moves, completely:** every table. `db/portable-schema.sql` is the same
schema with the four provider-specific dependencies isolated:

| Locked to Supabase | Portable form |
| --- | --- |
| `auth.users` | `app_users`, a table this schema owns |
| `auth.uid()` in ~20 RLS policies | `app.current_user_id()`, one adapter function |
| `storage.objects` | `documents.storage_path`, an opaque string |
| the `authenticated` role | the `app_user` role |

The adapter function is the whole trick. Every policy asks the same question —
*who is calling?* — and that is the only question providers answer differently.
Absorb it in one function and the twenty policies below it are byte-identical
everywhere. Without it, moving provider means rewriting every policy, and
rewritten permission rules are where permission bugs come from.

Then `scripts/db-export.mjs` and `scripts/db-import.mjs` are the small migration
script Bishop described.

**What does not move, and why that is fine:**

- **Password hashes.** Not exportable from any auth provider, by design. On a
  move, everyone resets their password once. `app_users` carries `auth_provider`
  and `auth_subject`, so the *identity* survives: a person gets a new Clerk
  subject written against their existing row and keeps every document they own,
  rather than arriving as a stranger. With around ten internal staff, one reset
  email is not a migration problem.
- **Document files.** The tables carry paths, not bytes. Moving providers means
  copying the bucket too, keeping paths identical so no row changes.

That is the honest boundary: **data portability is complete; identity
portability is preserved; credentials are re-established once.** No architecture
avoids that last one.

---

## 4. Step by step

Thirty minutes. Each step says why it exists, because several are easy to do in
the wrong order and only notice later.

### Step 1 — Create the Supabase project

At [supabase.com](https://supabase.com). Region: **`eu-west-1` (Ireland)** — the
nearest option to Accra, and noticeably faster from Ghana than a US region.

Name it `aic-dms-dev`. You want a second, separate project for production later;
one database with two front ends means a bad migration takes production with it.

### Step 2 — Apply the schema

Once `SUPABASE_DB_URL` is in `.env.local` (Step 4 covers where to find it):

```bash
npm run db:migrate --dry    # what would run
npm run db:migrate          # run it
```

Each migration runs in its own transaction and is recorded, so a failure rolls
back cleanly and a re-run skips what already applied. This is worth automating
because it is the step everything else depends on and the easiest to get half
right.

To do it by hand instead, paste each into the SQL Editor in this order, reading
the result of each before the next:

```
supabase/migrations/0001_init.sql          schema, RLS policies, the profile trigger
supabase/migrations/0002_storage.sql       private documents bucket
supabase/migrations/0003_organization.sql  tags and keyword search
supabase/migrations/0004_rag.sql           retrieval functions, vector index
supabase/migrations/0005_memory.sql        conversation memory
supabase/migrations/0006_intelligence.sql  summaries, tag suggestions, related documents
```

`0001` enables the `vector` extension; if it fails, nothing after it works.
`0004` needs `pgvector` new enough for HNSW indexes.

### Step 3 — Point Auth at the app

**Authentication → URL Configuration**

- Site URL: `http://localhost:3000`
- Redirect URLs: add `http://localhost:3000/auth/callback`

*Why first:* invitation and password-reset emails bake this URL in. Set it after
you have sent invitations and those emails point at the wrong host.

**Authentication → Providers → Email**: turn *Enable sign-ups* **off**.

*Why:* the app has no sign-up route, but this makes "invitation only" true at the
provider too, so no future route can accidentally re-open public registration.

### Step 4 — Fill in the environment

```bash
cp .env.example .env.local
```

From **Project Settings → API Keys**, fill the first four values. Leave the AI
keys empty for now — the platform runs fine without them; only Ask degrades to
keyword search.

**The dashboard will not say "anon key".** Supabase renamed these in 2026, and a
project created now shows the new pair. They map straight across:

| Dashboard | `.env.local` |
| --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| Publishable key (`sb_publishable_…`) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Secret key (`sb_secret_…`) | `SUPABASE_SERVICE_ROLE_KEY` |

The variable names keep the old wording because that is still what the Supabase
client library calls them. If you see a **Create new API keys** button, click it
— a fresh project may have no publishable key until you do.

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. It is a database password.
Never prefix it `NEXT_PUBLIC_`, never commit it. `.env.local` is gitignored.

### Step 5 — Create yourself as administrator

```bash
npm run bootstrap:admin -- you@aic.example
```

*Why a script rather than clicking through the console:* the manual version is
three steps across two consoles, you will do it at least twice, and it
half-succeeds silently if the profile trigger did not fire. The script creates
the auth user, **verifies the profile row actually exists** — catching a broken
migration `0001` right now rather than three days later — and sets your role to
`administrator`.

It prints a generated password once. Store it, then change it from the Account
page after signing in. To choose your own instead:

```bash
npm run bootstrap:admin -- you@aic.example --password 'something-long'
```

Safe to re-run: an address that already has an account is promoted, not
duplicated.

*Why this step cannot happen in the app:* there is no public sign-up, and
inviting requires an administrator. The first one has to come from outside. Every
account after this one is created by invitation from the Team page.

### Step 6 — Prove the permission model

```bash
npm run verify:rls
```

*Why before anything else:* this platform's entire security model is RLS
policies, and **RLS fails silently**. A wrong policy does not throw, it returns
rows. The script signs in as a user with no grant and asserts they cannot reach
a document, its chunks, its keyword hits, or its stored bytes. It creates and
deletes throwaway users, so run it against development, never production.

Until this passes, "unauthorised users cannot open restricted documents" is a
claim, not a fact.

### Step 7 — Walk it

```bash
npm run dev
```

Sign in at `http://localhost:3000/login`, then: invite a colleague from **Team**
→ accept on a second account → upload a document → share it → confirm it appears
→ revoke → confirm it disappears.

### Step 8 — Turn on the AI (optional, and after Bishop answers)

Add `ANTHROPIC_API_KEY` and an embedding key to `.env.local`, then re-index from
any document page.

*Why last:* this is the only point where document content leaves AIC's control,
and it is still an open question for Bishop. Everything above works without it.

---

## 5. If you do want to move to Neon later

```bash
node scripts/db-export.mjs                          # -> db/export/*.jsonl
node scripts/db-import.mjs --from db/export --target neon
psql "$NEON_DATABASE_URL" -f db/portable-schema.sql
psql "$NEON_DATABASE_URL" -f db/export/import.sql
```

Then add an auth provider, point `app.current_user_id()` at its JWT claim, move
the bucket, and have everyone reset their password once. `db/README.md` has the
detail, including the things a naive copy gets wrong.

The reason to keep the portable schema current — reconciled in the same commit
as any migration — is that a portable schema discovered to be three migrations
stale at the moment you need it is not a portable schema.
