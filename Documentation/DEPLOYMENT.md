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
   supabase/migrations/0007_roles_and_comments.sql
   supabase/migrations/0008_chat_and_context.sql
   ```

   Run them one at a time and read the result of each. `0001` enables the
   `vector` extension; if that fails, nothing after it will work. `0007` is the
   one that *removes* a permission — administrators stop being able to read
   document contents — so if that is not the intended policy, stop there and
   decide before running it.

   Or apply them all in one command with `npm run db:migrate`, which needs
   `SUPABASE_DB_URL`. Either way, rehearse first: `npm run verify:rls:local`
   applies the same migrations to a throwaway local Postgres and runs the 45
   permission assertions against them. That rehearsal is what caught the
   `array_to_string` defect in `0003` before it reached Supabase.
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
| `ANSWER_PROVIDER` | no | `anthropic` (default) or `openai-compatible` |
| `ANTHROPIC_API_KEY` | yes, for `anthropic` | Without it, Ask reports that answering is unconfigured |
| `ANSWER_BASE_URL` | yes, for `openai-compatible` | e.g. `https://api.groq.com/openai/v1` |
| `ANSWER_API_KEY` | no | Key for the `openai-compatible` provider |
| `ANSWER_MODEL` | no | Defaults to `claude-opus-5`; set `claude-haiku-4-5` in development. **Required** for `openai-compatible`. Safe to change at any time — no re-index |
| `OPENAI_API_KEY` | no | Without it, uploads are stored but not indexed, and Ask falls back to keyword search |
| `EMBEDDING_PROVIDER` | no | `openai` (default), `ollama`, or `openai-compatible` |
| `EMBEDDING_MODEL` | no | Defaults to `text-embedding-3-small` for `openai` and `qwen3-embedding:4b` for `ollama`. **Required** for `openai-compatible` |
| `EMBEDDING_BASE_URL` | no | Overrides the endpoint. Defaults to OpenAI's for `openai` and `http://127.0.0.1:11434/v1` for `ollama`. **Required** for `openai-compatible` |
| `EMBEDDING_API_KEY` | no | Key for a non-OpenAI provider. Falls back to `OPENAI_API_KEY`. Omitted entirely for a local Ollama, which wants no key |
| `EMBEDDING_OMIT_DIMENSIONS` | no | Set `true` only for a provider that rejects the `dimensions` parameter outright. Safe only if the model is natively 1536 wide |

### The free stack, for testing and a first deployment

Runs on Vercel, needs no credit card, and costs nothing.

```ini
# Answering — Groq. Free, no card, and its no-training-on-your-data posture is
# account-wide rather than a paid-tier feature.
#
# Model names here go stale fast: Groq deprecated llama-3.3-70b-versatile and
# llama-3.1-8b-instant on 17 June 2026. Check console.groq.com/docs/deprecations
# before trusting this line.
ANSWER_PROVIDER=openai-compatible
ANSWER_BASE_URL=https://api.groq.com/openai/v1
ANSWER_API_KEY=gsk_...
ANSWER_MODEL=openai/gpt-oss-120b

# Embeddings — Gemini through its OpenAI-compatible endpoint. Groq has no
# embedding models, so this half comes from elsewhere.
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=gemini-embedding-001
```

**Ollama Cloud is an equivalent alternative for the answering half**, and is
reachable from a serverless host in a way a local Ollama is not: it is a hosted
API at `https://ollama.com/v1` with an API key, not a process on somebody's
laptop. Set `ANSWER_BASE_URL` to it and `ANSWER_MODEL` to a cloud model such as
`minimax-m3`. Its free tier is metered by GPU time over rolling 5-hour and
weekly windows rather than by request count, which is harder to predict than
Groq's flat daily allowance — worth knowing before a demo.

**It cannot serve the embedding half.** Ollama publishes no embedding models as
cloud models; `qwen3-embedding` and `embeddinggemma` are local-only. So the
embedding provider has to be something a deployed application can actually
reach, which is why Gemini appears above.

> **Test documents only.** Google's free Gemini tier reserves the right to use
> submitted prompts and outputs to improve its products, human review included.
> That is acceptable for invented files while the pipeline is being proven, and
> not acceptable for AIC's real documents. Groq's half does not carry the same
> caveat.

**Moving off Gemini later costs a re-index, not a migration.** `gemini-embedding-001`
truncates to 1536 so the schema never changes, but a vector from one model is
not comparable with a vector from another — they place text in different
coordinate spaces, and mixing them degrades retrieval silently rather than
loudly. Every document has to be embedded again by whichever provider replaces
it. That is free today, with nothing indexed, and grows with the corpus, so it
is worth doing before real documents arrive rather than after.

### Choosing an embedding provider

Every option speaks OpenAI's `/v1/embeddings` shape, so changing provider is
configuration rather than code. What is *not* free to change is the width:
`document_chunks.embedding` is `vector(1536)`, fixed by migration 0001, and a
provider emitting anything else needs a schema migration **and a full re-index
of every document**. `embedAll` refuses a wrong-width vector rather than storing
it, and says which of the two fixes applies.

Matryoshka-trained models are the way through this: they are trained so a
shorter prefix is still a usable embedding, so they honour a `dimensions`
request. `qwen3-embedding` (2560 native at 4b, 4096 at 8b) and Google's
`gemini-embedding-001` (3072 native) all truncate cleanly to 1536. Most
open models do not — `nomic-embed-text` is 768, `mxbai-embed-large` and
`bge-m3` are 1024 — and those genuinely do cost a migration.

**A local Ollama is the only option that is free and private at once.** Nothing
leaves the machine, there is no key and no per-token cost, so it does not depend
on how a vendor's free tier treats submitted data. The trade is that it must run
somewhere the application can reach: fine for a laptop or a self-hosted box,
impossible on Vercel, where the app would need a hosted provider instead.

> **Read a free tier's data terms before pointing this at real AIC documents.**
> They are frequently weaker than the paid terms of the same vendor. Google's
> free Gemini tier, for one, reserves the right to use submitted prompts and
> outputs to improve its products, with human review possible, and its own terms
> advise against sending confidential material. A free tier is fine for testing
> against invented documents; sending AIC's actual files through one is the very
> thing the privacy question exists to decide.

The AI keys are genuinely optional. The document platform — the part that
replaces WhatsApp — works completely without them, which is the right failure
mode if the privacy question about sending documents to a third party is still
open.

---

## 3. Hosting

> **First time?** `VERCEL_SETUP.md` is the same thing as a click-by-click
> walkthrough — which button, which tab, which value goes where — for Vercel
> specifically. This section is the reference; that one is the path.

Any host that runs Next.js 16 works. Two constraints that are easy to miss:

- **Ingestion runs inside the upload request's process.** A 200-page PDF can
  take a minute to extract and embed. On a platform with a short function
  timeout, the upload still succeeds (the file and its row are written first)
  but indexing may be killed part-way, leaving the document in `processing`.
  The **Re-index** button on the document page is the recovery path, and moving
  ingestion to a queue is the fix if it becomes routine — see *Known limits*.
  Both `/api/documents` and `/api/rag/ask` declare `maxDuration = 60`, which is
  the ceiling a Vercel Hobby project allows; a paid plan can raise the number,
  and a host that reads the Next.js build output will honour whatever it says.
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

## 3b. Moving from personal to company API keys

It is reasonable to develop against personal Anthropic and OpenAI accounts —
neither vendor has a free tier worth planning around, both are cheap at this
scale, and waiting for a company account to exist would block every test.

**The rule while on personal keys: no real AIC documents.** Whatever is sent
sits under a personal account's terms, retention and jurisdiction, which is
exactly the arrangement nobody has approved. Test with invented documents — a
made-up fee schedule, a fictional programme outline. They exercise chunking,
retrieval and citation just as well as real ones.

**This swap must happen before the beta carries real documents.** Deploying on a
personal key means production runs on somebody's personal card, under somebody's
personal terms, and stops working the day that account lapses.

1. Create the organisation on an AIC address at
   [console.anthropic.com](https://console.anthropic.com) (and
   [platform.openai.com](https://platform.openai.com) for embeddings), and add
   billing. Both are prepaid credit, not invoiced.
2. Create a **workspace** per vendor with a monthly spend limit before creating
   any key, so a runaway loop cannot drain the balance.
3. Create the keys, scoped to those workspaces.
4. Replace `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in the host's environment
   and redeploy. No code changes — both are read at runtime.
5. **Revoke the personal keys.** An unrevoked key is a live credential nobody is
   watching.
6. Re-index the corpus (**Re-index** on each document) once real documents go in.

**Changing accounts is free; changing providers is not.** A different embedding
vendor produces vectors in a different space, so every stored embedding becomes
meaningless and the whole corpus needs re-indexing — and if its native width is
not 1536, `document_chunks.embedding` needs a schema migration too. That is why
`src/modules/rag/embed.ts` puts the provider behind an interface, and why the
privacy decision wants settling *before* anything real is indexed rather than
after.

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
7. Confirm `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` belong to the **company**
   accounts, not to anybody's personal one (§3b).

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
