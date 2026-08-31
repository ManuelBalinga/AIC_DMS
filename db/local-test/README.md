# Local permission-boundary test

Applies the migrations to a throwaway Postgres and asserts the RLS policies
grant and deny the right things — without Supabase, credentials, or a network.

```bash
LOCAL_DB_URL=postgresql://user:pass@127.0.0.1:5432/aic_test npm run verify:rls:local
```

**It drops and recreates `public`, `auth` and `storage`.** Never point it at
anything real.

## What it proves, and what it does not

| | |
| --- | --- |
| ⚠️ Migrations `0001`–`0009` completed the last full local run; `0010`–`0013` passed rollback-only hosted rehearsals | The runner is the same one used against Supabase; rerun all thirteen locally before deployment |
| ✅ The RLS policy logic is correct | 91 executable assertions cover document roles, administrator non-read access, direct/Team isolation, Team-inherited access, write refusal and retrieval boundaries |
| ✅ `handle_new_user` mirrors auth users into profiles | The bootstrap step depends on this |
| ❌ Supabase's own grants and ownership behave the same | Different roles, different owners |
| ❌ PostgREST exposes only what it should | Not present here at all |

`npm run verify:rls` against a real project remains the authority. This is the
cheap check that catches a broken policy in seconds rather than after a deploy.
The harness now contains 91 executable assertion calls. The recorded count was
stale; it has been recalculated directly from the SQL rather than incremented
from an old baseline. The full sequence still requires a complete local run on
a Postgres 15+ instance with pgvector.

## Why a stand-in is needed

The migrations reference Supabase-managed objects — `auth.users`, `auth.uid()`,
`storage.buckets` — that a plain Postgres does not have.
`00_supabase_harness.sql` creates minimal versions. The one that matters is
`auth.uid()`: here it reads a GUC rather than a JWT, which is what lets the test
impersonate a user with

```sql
set request.jwt.claim.sub = '…uuid…';
```

That substitution is the whole trick. Everything else is ordinary Postgres.

## Requirements

Postgres 15+ with `pgvector` available (`0004` builds an HNSW index, `0006`
averages vectors). On Debian/Ubuntu:

```bash
apt-get install -y postgresql-16 postgresql-16-pgvector
```
