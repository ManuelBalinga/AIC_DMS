# DevCollab — who did what, in order

An append-only log of contributions to AIC_DMS. Started 30 August 2026.

**This file is internal.** `PROJECT_STATUS.html` is the document shared with
Bishop and anyone outside the team; it describes *what the platform does* and
deliberately says nothing about who built which part. Keep it that way. This
file is where the attribution lives, so the status page can stay a clean
statement of the product.

---

## For Timi, and for Timi's AI assistant — read this first

### What this file is for

Two people are building this with AI assistants: **Manuel** (working with
Claude) and **Timi** (working with whichever assistant Timi uses). Neither pair
sees the other's chat history. This log is the shared memory between them.

Read the last few entries before starting work. They tell you what changed
recently and, more usefully, *why* — which is the part that never survives in a
diff.

### The one rule

> **Append. Never edit or delete somebody else's entry.**

New entries go at the **bottom**. The file reads oldest-first, so the newest
work is always the last thing on the page. If Timi commits after Manuel,
Timi's entry sits below Manuel's. If Manuel then commits again, his next entry
sits below Timi's. The order is the true order of events, and it stays that way
because nobody rewrites history above their own entry.

Correcting your *own* earlier entry is fine — strike it through and explain in a
new entry at the bottom, rather than quietly editing it. The point of a log is
that it records what was believed at the time.

### When to write an entry

After any change you would want the other person to know about. That includes:

- code, schema migrations, or configuration
- decisions taken (especially ones that close off an option)
- anything you tried that **did not** work, and why — this saves the other
  person repeating it, and is often the most valuable entry in the file
- anything you deliberately left broken or unfinished

Not for: typo fixes, formatting, or work you abandoned before it touched the
repo.

### The format

Copy this block, fill it in, paste it at the bottom of the file.

```markdown
### YYYY-MM-DD — <Name> + <assistant>

**<One line saying what changed.>**

<Two to five sentences. What you did, and why. If you made a decision, say what
you ruled out and what would reverse it. If something broke, say what and where
it stopped.>

- Files: `path/one.ts`, `path/two.sql`
- Commits: `abc1234`
- Status: done / in progress / blocked on <what>
```

Name the person first and the assistant second — `Timi + Cursor`,
`Manuel + Claude`, `Timi + OpenCode`. It matters later which assistant produced
a given piece of code, because they have different failure modes.

### Instructions for the AI assistant

If you are an AI assistant working on this repository, these apply to you:

1. **Update this file in the same turn as the work**, not at the end of a
   session. A log written from memory hours later is a summary, not a record.
2. **Append at the bottom.** Never reorder, never rewrite, never delete an entry
   that names somebody else.
3. **`git pull` before you write.** Two assistants appending to the same file
   is the one reliable way to create a merge conflict here. Pull, append, commit,
   push — in that order, promptly. Do not leave an entry sitting uncommitted.
4. **If you hit a conflict in this file, keep both entries.** Order them by date.
   Never resolve a conflict by discarding somebody's entry.
5. **Do not put attribution in `PROJECT_STATUS.html`.** That document is shared
   externally and stays impersonal. Update it too when deliverable status
   changes — but it says *what* is built, and this file says *who*.
6. **Record failures honestly.** "Tried X, it did not work because Y" is worth
   more to the other pair than a clean success story. Do not tidy it away.
7. **Say what is unverified.** "Built" and "proven to work" are different
   things, and this project has been careful about the difference throughout.

### Where the project's own context lives

| File | What it tells you |
| --- | --- |
| `PROJECT_STATUS.html` | Every deliverable, and whether it is built or verified. **Read this first.** |
| `Documentation/DEPLOYMENT.md` | Environment variables, the free AI provider stack |
| `Documentation/DATABASE_DECISION.md` | Why Supabase and not Neon; where accounts live |
| `Documentation/ROLE_MODEL.md` | Who can do what |
| `Documentation/TEAM_COMMUNICATION.md` | The chat design, decided but mostly unbuilt |
| `Documentation/OFFLINE_ACCESS.md` | The offline design, decided and unbuilt |
| `Documentation/BISHOP_NOTES.md` | What the client asked for, and what was done about it |
| `CLAUDE.md` / `AGENTS.md` | Project conventions |

---

# Log

### 2026-08-18 to 2026-08-28 — Manuel + Claude

**Everything up to this point.** Backfilled on 30 August from the git history,
so it is grouped by theme rather than written live. Entries after this one are
written as the work happens.

47 commits. Summarised below in the order it happened.

---

**18–19 Aug · The platform itself.** Built the whole first version: Next.js 16
app, Supabase Postgres, invitation-only authentication with no sign-up route,
private document storage with signed-URL downloads, per-document permissions
enforced by Postgres Row Level Security rather than application code, tags and
two kinds of search, and a full RAG pipeline — extraction for PDF/DOCX/XLSX/
PPTX/text, page-aware chunking, embeddings behind a provider interface, hybrid
semantic-plus-keyword retrieval, and streamed answers with citations that link
to the source document and page.

The load-bearing design decision: **retrieval contains no permission filter.**
Both retrieval functions are `SECURITY INVOKER` over `document_chunks`, so
Postgres removes forbidden passages before the application sees them. A future
change cannot leak a document by forgetting a `where` clause, because the clause
was never in that layer to forget.

- Status: done

---

**19 Aug · Conversation memory, and a portable schema.** Ask was stateless, so
follow-ups were impossible. Added threads, turns and stored citations, plus a
rolling summary for turns that age out. The subtle part: a follow-up like "what
about the fees?" carries almost no meaning on its own, so it is rewritten into a
standalone query **before** retrieval — by the time generation starts, the wrong
passages have already been chosen.

Also built `db/portable-schema.sql` and export/import scripts, so records can
move between Postgres providers. This answers Bishop's requirement directly.

- Status: done

---

**19 Aug · Admin bootstrap, migration runner, test suite.** The first account
cannot be created through the app — no sign-up, and inviting requires an
administrator — so `npm run bootstrap:admin` exists for exactly that. Added
`npm run db:migrate` to apply migrations in order with a ledger, and a test
suite that grew to 77 tests.

One test earned its place immediately: a schema-parity check comparing
`supabase/migrations/` against `db/portable-schema.sql` **failed on its first
run**, catching that the portable schema still carried the bare
`array_to_string` expression that had already broken migration `0003`. A move to
Neon would have hit the identical error.

- Status: done

---

**19 Aug · Decided: Supabase, not Neon.** Bishop recommended Neon. Decision was
to stay on Supabase and record why, since it runs against a direct
recommendation: Neon is *only* a database — no auth, no object storage — so
adopting it means Neon **and** Clerk **and** an object store, three vendors
replacing one, and a rewrite of the two subsystems already finished.

**What would reverse it:** an AIC policy against storing documents with a
US-hosted vendor. The portable schema keeps that exit proven rather than
theoretical.

- Files: `Documentation/DATABASE_DECISION.md`
- Status: decided

---

**20 Aug · The schema went live.** All migrations applied to the Supabase
project for the first time. Verified by inspection: tables created, **RLS
enabled on every one**, private documents bucket at its 50 MB cap, HNSW vector
index built on pgvector 0.8.2, and the `on_auth_user_created` trigger installed
on `auth.users` — which was the flagged risk, since it needs rights on a schema
Supabase owns.

The local rehearsal on 19 Aug paid for itself here: it had already caught the
`0003` immutability defect that would otherwise have stopped this attempt dead.

- Status: done

---

**21 Aug · Roles, comments, deactivation.** Expanded the role model: viewer,
commenter, editor and owner per document, on top of administrator and member at
the platform level. Threaded comments anchored to a document or a page.

**A permission was deliberately removed here:** administrators lost the ability
to read document contents. They manage access — which is their job — but cannot
read what they have not been shared. Same reasoning later applied to closed team
conversations.

People are deactivated, never deleted. A `before update` trigger on `profiles`
prevents reaching zero administrators, enforced in the database rather than the
UI so it holds whichever code path attempts it.

- Status: done

---

**21–24 Aug · Team communication and offline access designed.** Both specified
in full and deliberately **not built**, so the beta was not buried under new
surface area.

Team communication copies Slack's shape where it earns its place. The rule
holding it up: **a message can never carry a file.** This platform exists
because documents in WhatsApp could not be found, controlled or withdrawn, and a
chat accepting attachments rebuilds exactly that one layer further in. A message
may *reference* a document and never contain one.

Manuel's decisions: sharing targets a person **or** a team, both permanently;
administrators cannot read closed teams or DMs; **nothing is ever deleted**,
because a conversation record is corporate evidence. That last one forced two
consequences — delete becomes *retract*, and edits are versioned rather than
overwritten, since an overwriting edit would make the audit trail a lie.

Offline access resolved a similar tension: an offline file sits outside access
control, but **the Download button already exists**, so a managed cache with a
lease, revocation and a record is strictly more controlled than what people
already do.

- Files: `Documentation/TEAM_COMMUNICATION.md`, `Documentation/OFFLINE_ACCESS.md`
- Status: designed, not built

---

**24–25 Aug · AI providers made swappable.** `EMBEDDING_PROVIDER` and
`ANSWER_PROVIDER` now accept OpenAI, Ollama, or any OpenAI-compatible vendor,
all through one request function. This means **RAG can run at zero cost** and,
with Ollama, without anything leaving the machine.

The distinction that matters and is easy to miss: **the answering model is free
to change; the embedding model is not.** Every stored vector came from one
model, so switching embedding providers invalidates the whole corpus and forces
a re-index — and a provider that cannot emit 1536 dimensions needs a schema
migration on top.

- Status: done

---

**25–27 Aug · Made it deployable, then deployed.** Uploads go straight to
storage so a serverless host can handle them. Documented the environment traps,
particularly that `NEXT_PUBLIC_*` variables are baked in at build time and need
a rebuild rather than a restart.

- Status: done

---

**28 Aug · Contextual embeddings.** Chunking destroys what made a passage
meaningful — its place in the document. A chunk reading *"the fee is GHS 500 per
participant"* names neither the programme nor the year, so the passage holding
the answer becomes the one passage retrieval cannot find.

Fixed by embedding each chunk with a short header naming its document, tags and
page. Two properties matter: the header never reaches `content`, because
`content` is what a citation quotes and a citation of a preamble would quote
something the document does not say; and it costs no extra model call, being
assembled from metadata ingestion already produces.

- Status: done

---

**28 Aug · Two member accounts verified.** Both coworker accounts confirmed able
to sign in — the first end-to-end proof that invitation, email delivery and
authentication work against the deployment rather than in principle.

- Status: done

---

**30 Aug · Migrations 0007–0009 applied, and this file created.** Found that
three migrations existed in the repository but had never been applied to
Supabase, so the code expected tables the database did not have — the document
page called `can_comment_on_document`, which did not exist, and would have
crashed. Applied all three. Schema and code now agree.

Created `DEVCOLLAB.md` ahead of Timi joining the project.

- Files: `DEVCOLLAB.md`, `supabase/migrations/0007`–`0009`
- Status: done

---

## Where things stand as Timi joins

**Built and working:** documents, permissions, roles, comments, search, RAG
pipeline, conversation memory, team messaging, deployment on Vercel.

**Decided but not built:** team communication as specified in
`TEAM_COMMUNICATION.md` (the shipped chat diverges from it — the tables are
`chat_threads`/`chat_participants`/`chat_messages` rather than the `teams`
naming the spec agreed), and everything in `OFFLINE_ACCESS.md`.

**Known open items:**

1. `npm run verify:rls` has never been run against the live Supabase project.
   The permission model is tested locally but unproven where it matters. This is
   the highest-value thing anybody could do next.
2. AI provider keys are not set in every environment, so indexing reports as
   unconfigured and Ask falls back to keyword search. That is correct behaviour,
   not a bug.
3. Still waiting on Bishop: sample AIC documents, and a decision on which AI
   provider is acceptable on privacy grounds.

**A convention worth keeping:** this project has been careful to distinguish
*built* from *verified*. "Built" means code-complete and passing checks. Only
call something verified if it actually ran against the real system. The status
page carries a counter for exactly this, and it has been kept honest.

---

<!-- New entries go below this line, oldest first. Append; never edit above. -->

### 2026-08-30 — Manuel + Claude

**Onboarding prompt written for Timi; DEVCOLLAB pushed to both branches.**

Added `Documentation/COLLABORATOR_ONBOARDING.md` — a prompt Timi pastes into
his first chat with his assistant. It carries the two things this project is
easiest to get wrong: permissions live in Postgres policies rather than in
TypeScript, and **RLS fails silently**, so a broken permission shows up as an
empty page rather than an error. It also names the built-versus-verified
distinction, since an assistant with no history here would otherwise report
"done" the moment the types compile.

`main` and `Claude-Dev` are now identical, so Timi sees the same file whichever
he clones.

- Files: `Documentation/COLLABORATOR_ONBOARDING.md`, `DEVCOLLAB.md`
- Status: done. Repository access for Timi is still outstanding — he cannot
  clone a private repo until he is added as a collaborator on GitHub.
