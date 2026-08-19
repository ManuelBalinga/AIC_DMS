# Database portability

The platform's records must be movable from one Postgres provider to another —
Supabase to Neon, Neon to Supabase, either to plain Postgres — without a
rewrite. This directory is what makes that true, and what it costs.

Live today: **Supabase**. Everything here exists so that stops being a
one-way decision.

| File | Role |
| --- | --- |
| `portable-schema.sql` | The whole schema, with no provider-specific dependency. Runs on Neon, plain Postgres, or Supabase. |
| `../scripts/db-export.mjs` | Reads every record out of the live Supabase project into JSONL. |
| `../scripts/db-import.mjs` | Turns that export into SQL for any Postgres, or writes it into another Supabase project. |
| `../supabase/migrations/` | What is actually deployed today. Supabase-native, and the source of truth until a move happens. |

## What makes a schema portable

Four dependencies are what normally lock a Postgres schema to its provider.
Each is isolated to one place rather than spread through the schema:

| Provider-specific thing | Portable form | Where it lives |
| --- | --- | --- |
| `auth.users` (Supabase's own table) | `app_users`, a table this schema owns | `portable-schema.sql` |
| `auth.uid()` in every RLS policy | `app.current_user_id()` | one adapter function |
| `storage.objects` handles | `documents.storage_path`, an opaque string | one column |
| the `authenticated` role | the `app_user` role | role grants |

The adapter function is the important one. Every RLS policy in this platform
asks the same question — *who is calling?* — and that is the only question a
provider answers differently. On Supabase the function delegates to
`auth.uid()`; anywhere else the application sets a transaction-scoped variable
after authenticating the request itself:

```sql
select set_config('app.current_user_id', $1, true);
```

The `true` is not optional. It scopes the setting to the transaction, so a
pooled connection cannot carry one request's identity into the next request's
queries — which on a connection-pooled provider is the difference between a
permission system and a coin flip.

Because that one function absorbs the difference, the ~20 RLS policies below it
are byte-identical across providers. Without it, a provider move means
rewriting every policy, which is where permission bugs come from.

## Moving to Neon

```bash
# 1. Export the current records
node scripts/db-export.mjs                       # -> db/export/*.jsonl

# 2. Generate the insert script
node scripts/db-import.mjs --from db/export --target neon

# 3. Create the schema and load the data
psql "$NEON_DATABASE_URL" -f db/portable-schema.sql
psql "$NEON_DATABASE_URL" -f db/export/import.sql
```

Neon's CLI works the same way if you would rather not handle the connection
string:

```bash
neonctl connection-string --database-name aic | xargs -I {} psql {} -f db/portable-schema.sql
```

`import.sql` is a plain file. Read it before running it — that is most of why
this script emits SQL instead of opening a connection.

## What the scripts get right that a naive copy does not

- **Primary-key ordering when paging.** Paging by `created_at` lets two rows
  written in the same millisecond swap places between pages, which drops one
  and duplicates the other.
- **Generated columns.** `documents.search_vector` is
  `generated always as … stored` and cannot be inserted into. It is excluded by
  the explicit column lists, not by hoping.
- **Trigger-maintained counters.** Inserting a `conversation_messages` row
  fires `touch_conversation_on_message`, which would add to a `message_count`
  that arrived already correct. The import disables that trigger and then
  recomputes the counters from the rows that actually landed.
- **Postgres array literals.** `["a","b"]` is valid JSON and invalid Postgres.
  Tags are emitted as `'{"a","b"}'`.
- **Embeddings.** pgvector reads back as `"[0.1,0.2,…]"`, which is already its
  own input format — so it survives as a quoted string, and does not need the
  1536 floats reconstructed.
- **Re-runnability.** Every insert is `on conflict do nothing`, so a partial
  import can be re-run. Deliberately not `do update`: an import must never
  quietly overwrite something that changed on the target.

## What does not move, and what to do about it

**Document bytes.** The tables carry `storage_path`, not the files. Moving
providers means moving the objects too — download the `documents` bucket and
upload it to whatever replaces it, keeping paths identical so no row needs
touching. Neon has no object store, so a Neon move needs a separate answer for
files (S3, R2, Supabase Storage kept on its own).

**Passwords.** They live in the auth provider, hashed, and are not exportable —
by design, and it is the right design. A move to Neon (which has no auth) or to
Clerk means every user goes through a password reset once. `app_users` carries
`auth_provider` and `auth_subject` so the *identity* survives that: a user gets
a new Clerk subject written against their existing row, and keeps every document
they own rather than arriving as a new person with none.

**Vector index build time.** `document_chunks_embedding_idx` is an HNSW index;
on a large corpus it takes a while to build on the target. It is created by
`portable-schema.sql` before the import, which is the slow way round. For a
large move, comment it out, import, then create it — the same trick as any bulk
load.

## Keeping the two schemas honest

`portable-schema.sql` and `supabase/migrations/` describe the same tables and
can drift apart. They are reconciled by hand today, which is a real cost, and it
is the price of not having committed to one provider. When a migration adds a
column, add it here in the same commit — a portable schema discovered to be
three migrations stale at the moment you need it is not a portable schema.
