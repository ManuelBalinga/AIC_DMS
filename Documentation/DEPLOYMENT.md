# Deployment

Two environments, as the plan asks for (§8): a development project you can break
and a production project you cannot. They are separate Supabase projects and
separate deployments — never the same database with a different front end,
because a bad migration in development would then take production with it.

| | Development | Production |
| --- | --- | --- |
| Supabase project | `aic-dms-dev` | `aic-dms` |
| Site URL | `http://localhost:3000` | `https://<the real domain>` |
| Who can sign in | You, plus test accounts | Invited AIC staff only |
| Documents | Throwaway samples | Real AIC documents |

---

## 1. Supabase (per environment)

1. Create the project at [supabase.com](https://supabase.com). Pick the region
   closest to Accra — `eu-west-1` (Ireland) is currently the nearest option and
   noticeably faster from Ghana than a US region.
2. Run the migrations in order from the SQL Editor:

   ```
   supabase/migrations/0001_init.sql
   supabase/migrations/0002_storage.sql
   supabase/migrations/0003_organization.sql
   supabase/migrations/0004_rag.sql
   supabase/migrations/0005_memory.sql
   supabase/migrations/0006_intelligence.sql
   ```

   Run them one at a time and read the result of each. `0001` enables the
   `vector` extension; if that fails, nothing after it will work.
3. **Authentication → URL Configuration**
   - Site URL: the environment's own URL.
   - Redirect URLs: add `<site url>/auth/callback`.
4. **Authentication → Providers → Email**: turn *Enable sign-ups* **off**. The
   application has no sign-up route, but this makes the no-public-registration
   rule true at the provider as well, so a future route cannot accidentally
   re-open it.
5. **Authentication → Rate limits**: leave the defaults. The password-recovery
   endpoint is public and the default limit is what stops it being used to spray
   email at AIC staff.
6. Create the first administrator by hand — the invitation flow needs one to
   exist before it can invite anybody:

   ```sql
   -- After creating your account under Authentication → Users → Add user
   update public.profiles
   set role = 'administrator'
   where email = 'you@example.com';
   ```

---

## 2. Environment variables

Set these on the host, not in a committed file. `SUPABASE_SERVICE_ROLE_KEY`
bypasses Row Level Security entirely — treat it like a database password.

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Safe in the browser; RLS still applies |
| `NEXT_PUBLIC_SITE_URL` | yes | Must match the Supabase Site URL exactly, or invitation links land on the wrong host |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server only. Never prefix `NEXT_PUBLIC_` |
| `ANTHROPIC_API_KEY` | no | Without it, Ask reports that answering is unconfigured |
| `OPENAI_API_KEY` | no | Without it, uploads are stored but not indexed, and Ask falls back to keyword search |
| `EMBEDDING_PROVIDER` | no | Defaults to `openai` |
| `EMBEDDING_MODEL` | no | Defaults to `text-embedding-3-small` |

The AI keys are genuinely optional. The document platform — the part that
replaces WhatsApp — works completely without them, which is the right failure
mode if the privacy question about sending documents to a third party is still
open.

---

## 3. Hosting

Any host that runs Next.js 16 works. Two constraints that are easy to miss:

- **Ingestion runs inside the upload request's process.** A 200-page PDF can
  take a minute to extract and embed. On a platform with a short function
  timeout, the upload still succeeds (the file and its row are written first)
  but indexing may be killed part-way, leaving the document in `processing`.
  The **Re-index** button on the document page is the recovery path, and moving
  ingestion to a queue is the fix if it becomes routine — see *Known limits*.
- **The `unpdf` and `mammoth` parsers run server-side and need Node**, not an
  edge runtime. The routes that use them are Node-runtime by default; do not
  add `export const runtime = "edge"` to them.

Build and start:

```bash
npm ci
npm run build
npm run start
```

---

## 4. Before letting anyone in

Run these against the environment, in order. The first two are the ones that
actually gate a launch.

```bash
npm run typecheck
npm run lint
npm run verify:rls
```

`verify:rls` signs in as a user with no grant and asserts they cannot read a
document, its chunks, or its stored bytes. Run it against **development** — it
creates and deletes throwaway users, which you do not want happening in the
production auth table.

Then walk the flow by hand, because no script covers the parts a person sees:

1. Invite a colleague from **Team**; confirm the email arrives.
2. Accept the invitation, set a password, land on the dashboard.
3. Upload a real AIC document. Watch the index status reach *Searchable by AI*.
4. Share it; confirm it appears for the other account.
5. Ask a question whose answer is in that document; check the citation links to
   the right document and page.
6. Revoke access; confirm the document disappears and the answer stops citing it.

---

## Known limits at beta

Stated here so they are chosen rather than discovered.

- **Ingestion is in-process, not queued.** Fine for the upload volume of an
  internal document platform; the wrong shape for a bulk import of hundreds of
  files at once.
- **No OCR.** A scanned PDF with no text layer indexes to zero passages and
  reports as much. Choosing an OCR tool needs real AIC scans to test against.
- **The embedding vector width is fixed at 1536 by the schema.** Switching
  embedding provider to one with a different width is a migration plus a
  re-index of every document, not a config change.
- **Answer generation sends passages to Anthropic.** This is the one place
  document content leaves AIC's control, and it is the open question in §9 of
  the plan.
