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

### 2026-08-30 — Timi + Codex

**Established Timi's development baseline and reconciled the project records with the live state.**

Worked exclusively on `Timi-Dev`. Installed the locked Node dependencies
and ran the full repository checks: lint, typecheck, all 112 unit tests and the
Next.js production build pass. The first install was incomplete on Windows
(`csstype` was truncated and `hermes-parser` lacked its entry file), so the
generated `node_modules` directory was removed and rebuilt with `npm ci`; the
clean install reports 419 packages and no vulnerabilities.

Reconciled the status page, setup guides, runbooks and module READMEs against the
authoritative plan, current code, git history and this log. They now agree that
all nine migrations are applied, deployment exists, the unit suite has 112
tests, Ask retrieves group messages but never direct messages, and hosted RLS
plus the complete browser flow remain unverified. Deployment moved to Built and
the personal-machine setup row was removed from the client-facing status page,
leaving 59 of 80 tracked deliverables Built. Attribution remains here rather
than in `PROJECT_STATUS.html`, as required.

Removed only five unreferenced Create Next App SVGs and one duplicate build
ignore rule. Preserved every plan, migration, history file, future Teams/offline
design and the isolated Deep Agents experiment. `.env.local` is absent
in this checkout, so no live Supabase command was attempted; credentials must be
retrieved from approved dashboards and the live RLS suite must target a
development project only.

- Files: `PROJECT_STATUS.html`, `README.md`, `.env.example`, `Documentation/`, `db/`, `src/modules/*/README.md`, `public/*.svg`, `DEVCOLLAB.md`
- Commits: this `Timi-Dev` commit
- Status: done; hosted RLS, deployed browser flow and representative-document testing remain unverified

### 2026-08-31 — Timi + Codex

**Connected the project-scoped Supabase MCP, audited the hosted database and built the first hardening migration.**

Worked exclusively on `Timi-Dev`. Registered and OAuth-authenticated the Supabase
MCP for project `pduohcdyszjlnmchhvws`; no service-role or database secret was
copied into chat or committed. The ignored `.env.local` now carries only the
project URL and modern publishable key supplied by MCP. The secret/service-role
field remains blank.

The read-only hosted inventory found 13 public tables with RLS enabled, 29
policies, a private 50 MB `documents` bucket, three confirmed accounts, nine
applied repository migrations and no Supabase development branches. Supabase's
advisors reported 28 security notices and 23 performance notices: the actionable
database findings were public execution of twelve `SECURITY DEFINER` functions,
one mutable function search path and eight unindexed foreign keys. A separate
grant audit found `anon` and `authenticated` held every privilege, including
`TRUNCATE` and `TRIGGER`, on every public relation. Leaked-password protection is
also disabled and requires a dashboard setting; the vector extension location and
unused-index notices were recorded but not changed without evidence.

Added `0010_security_hardening.sql`. It moves RLS-bypass helpers into a non-exposed
`private` schema, keeps the three intentional application RPCs behind
identity-checking `SECURITY INVOKER` wrappers, revokes direct execution from
trigger-only functions, replaces blanket Data API privileges with the minimum
per-table operations used by the application, locks down future defaults and adds
all eight missing foreign-key indexes. The complete migration executed successfully inside
`BEGIN`/`ROLLBACK` on hosted Supabase, and a follow-up query proved nothing
persisted. It has **not** been deployed: the only MCP target is the main hosted
database, so deployment waits for a development branch or Timi's explicit main
project approval.

The migration ledger also exposed a Windows/Linux false-positive: identical SQL
had different checksums under CRLF and LF. The runner now hashes canonical line
endings while accepting historical raw hashes. Three regression tests pin that
unchanged cross-platform files pass and genuine edits still fail. Lint,
typecheck, all 115 unit tests and the Next.js production build pass.

- Files: `supabase/migrations/0010_security_hardening.sql`, `scripts/db-migrate.mjs`, `scripts/migration-checksum.mjs`, `tests/migration-checksum.test.ts`, `src/lib/types/database.ts`, `PROJECT_STATUS.html`, `README.md`, `Documentation/OPEN_REQUESTS.md`, `Documentation/VERCEL_SETUP.md`, `db/local-test/README.md`, `DEVCOLLAB.md`
- Hosted changes: none; OAuth/MCP registration is local Codex configuration and the SQL rehearsal was rolled back
- Status: code-complete; migration deployment, leaked-password dashboard setting, hosted RLS suite and browser flow remain open

### 2026-08-31 — Timi + Codex

**Built the first substantial Phase 5 collaboration release: replies, mentions,
reactions, retained edit history and message retraction.**

Worked exclusively on `Timi-Dev`. Migration
`0011_message_collaboration.sql` evolves the existing message store rather than
creating a second permission model. It adds one-level, same-conversation reply
ancestry; relational mentions restricted to real participants; five
identity-bound reactions; immutable prior versions on edit; and irreversible
retraction. Ordinary users no longer hold the Data API privilege or RLS policy
needed to hard-delete a message. Retraction keeps the evidence record and reply
shape, replaces ordinary content with a tombstone, clears its embedding and
hides the retained body from participant queries. Direct messages remain
excluded from Ask under migration `0009`.

The `/messages/[threadId]` interface now renders threaded replies, mention
badges and reaction counts; lets a participant mention colleagues when sending;
and lets a sender edit, inspect prior versions and retract. The send operation
and its mentions are one database transaction. The shared presentation module
keeps reply grouping client-safe without importing the server-only query layer.

Added eight unit tests, raising the suite from 115 to 123, and expanded the
permission harness from 49 to 82 authored assertions. Lint, typecheck, all 123
tests, schema parity and the Next.js production build pass. Migrations `0010`
and `0011` were installed together on the hosted PostgreSQL version inside
`BEGIN`/`ROLLBACK`. A second rollback-only rehearsal exercised a real
participant and outsider across sending a reply, relational mention, reaction,
edit history, retraction, retained-text hiding and hard-delete denial. Every
assertion passed and the transaction was rolled back; the hosted schema and data
were not changed.

The project status moved three Phase 5 deliverables to Built: threaded replies,
mentions and reactions; retention with no ordinary hard-delete; and retract plus
versioned edits. Overall progress is now 63 of 81. Built still does not mean
deployed: the live database remains on migrations `0001`–`0009`, so the new UI
must not be deployed ahead of `0010`–`0011`, and the full browser flow remains
unverified.

- Files: `supabase/migrations/0011_message_collaboration.sql`, `db/portable-schema.sql`, `db/local-test/01_permission_boundary.sql`, `src/lib/types/database.ts`, `src/modules/chat/`, `src/app/(app)/messages/[threadId]/`, `tests/chat-collaboration.test.ts`, `PROJECT_STATUS.html`, `README.md`, `Documentation/TEAM_COMMUNICATION.md`, `Documentation/OPEN_REQUESTS.md`, `Documentation/VERCEL_SETUP.md`, `DEVCOLLAB.md`
- Hosted changes: none; all SQL rehearsal work was explicitly rolled back
- Status: code-complete and rollback-rehearsed; migrations `0010`–`0011`, browser verification and the full hosted RLS suite remain open

### 2026-08-31 — Timi + Codex

**Reconciled the messaging foundation with the agreed Phase 5 Teams model and
added membership-derived document sharing.**

Worked exclusively on `Timi-Dev`. Migration `0012_teams_foundation.sql` evolves
the existing chat tables in place into durable Direct and Team kinds. Direct
messages are now fixed, participant-only two-person conversations; Teams have a
name, purpose, open/closed visibility, governed membership and separate
metadata/content authority. Open Teams are discoverable and readable by active
staff. Closed Teams are hidden from ordinary non-members, while administrators
can manage membership without reading messages. Ask retrieves only policy-
visible Team messages and never a DM. Historical rows are migrated
conservatively so malformed or group-shaped records become closed Teams rather
than being discarded. The staff administration route is now `/admin/people`,
with permanent redirects from the legacy `/admin/team` routes.

Migration `0013_team_document_access.sql` adds one durable document grant per
Team. Permissions follow current membership at query time: joining inherits the
Team's Viewer, Commenter or Editor access and removal withdraws it immediately.
Direct and Team grants compose, with the higher effective role winning; Direct
messages are rejected as permission groups. The document sharing panel now
accepts people or Teams and labels the source of each grant. Team membership
management shows the inherited-document count and requires confirmation before
adding a person who will gain those documents.

The Supabase and portable PostgreSQL schemas remain in parity. The local RLS
harness now contains 91 executable assertions, including fixed two-person DMs,
closed-Team isolation and membership-derived document access. The full pending
migration sequence through `0013` installed successfully on hosted PostgreSQL
inside rollback-only transactions. The behavior rehearsal exercised Team
creation, closed/open visibility, administrator metadata-only access, Team
document inheritance and immediate withdrawal on member removal. It also caught
and corrected two pre-deployment defects: missing policy-helper execution grants
and Team creation's `INSERT ... RETURNING` policy timing. No hosted schema or
data change persisted.

Lint, typecheck, all 137 tests, schema parity and the Next.js 16 production build
pass. `PROJECT_STATUS.html` moved five Phase 5 deliverables to Built and now
reports 68 of 81. Built does not mean deployed or browser-verified: the sole
hosted project remains on migrations `0001`–`0009`, and deployment still needs
an explicitly approved target.

- Files: `supabase/migrations/0012_teams_foundation.sql`, `supabase/migrations/0013_team_document_access.sql`, `db/portable-schema.sql`, `db/local-test/01_permission_boundary.sql`, `src/modules/chat/`, `src/modules/access/`, `src/app/(app)/messages/`, `src/app/(app)/documents/[id]/`, `src/app/(app)/admin/people/`, `tests/teams-foundation.test.ts`, `tests/team-document-access.test.ts`, `PROJECT_STATUS.html`, `README.md`, `Documentation/TEAM_COMMUNICATION.md`, `Documentation/OPEN_REQUESTS.md`, `Documentation/VERCEL_SETUP.md`, `DEVCOLLAB.md`
- Hosted changes: none; every SQL installation and behavior rehearsal was explicitly rolled back
- Status: code-complete and rollback-rehearsed; migrations `0010`–`0013`, browser verification and the full hosted RLS suite remain open

### 2026-08-31 — Timi + Codex

**Completed the next actionable Phase 5 deliverable: permission-aware document
references in Team and Direct conversations.**

Worked exclusively on `Timi-Dev`. Migration
`0014_permission_aware_document_references.sql` adds retained relational pointers
from messages to governed documents without copying file bytes, titles,
filenames, excerpts or URLs into chat. The base reference table is insert-only
for authenticated callers and not selectable through the Data API. A narrow
request-aware projection returns a linkable document card only when the current
reader can actually open the document; otherwise every document field,
including the identifier and title, is null and the UI renders a generic locked
card. Existing cards lock and unlock dynamically as document grants and Team
membership change. Deleting a document leaves an unavailable-card evidence row
rather than silently rewriting conversation history.

The composer now lists only documents the sender may read and performs an
aggregate preflight before posting. When conversation readers lack access, the
sender must choose to grant Team Viewer access and send atomically, post a
locked card, review the document's sharing panel, or cancel the reference. The
send RPC recomputes access at commit time to close the membership-change race.
Direct messages can reference a document but can never grant permissions. For
open Teams the warning says explicitly that a Team grant covers members while
non-member staff may still receive a locked card.

The migration was mirrored into the portable PostgreSQL schema and the local
permission harness now contains 98 executable assertions, including title-free
locked cards, raw-table denial, closed-Team outsider/administrator denial,
dynamic unlock and atomic Team grants. Seven new migration tests raise the full
suite to 144. Migrations `0010`–`0014` parse-installed together on hosted
PostgreSQL inside `BEGIN`/`ROLLBACK`; a separate real-role rehearsal proved
aggregate gaps, null title/ID projection, dynamic unlock after Team grant and
continued locking for a non-member administrator. Every transaction was rolled
back and no hosted schema or data changed.

Lint, typecheck, all 144 tests, schema parity and the Next.js 16 production build
pass. `PROJECT_STATUS.html` moves permission-aware document references to Built
and reports 69 of 81. Built does not mean deployed or browser-verified: browser
interaction is blocked until migrations `0010`–`0014` have an approved target,
because the free-plan project has no disposable Supabase branch.

- Files: `supabase/migrations/0014_permission_aware_document_references.sql`, `db/portable-schema.sql`, `db/local-test/01_permission_boundary.sql`, `src/lib/types/database.ts`, `src/modules/chat/actions.ts`, `src/modules/chat/queries.ts`, `src/modules/chat/presentation.ts`, `src/modules/chat/README.md`, `src/app/(app)/messages/[threadId]/composer.tsx`, `src/app/(app)/messages/[threadId]/conversation-view.tsx`, `src/app/(app)/messages/[threadId]/page.tsx`, `src/components/ui/index.tsx`, `tests/document-references.test.ts`, `tests/chat-collaboration.test.ts`, `PROJECT_STATUS.html`, `README.md`, `Documentation/TEAM_COMMUNICATION.md`, `Documentation/OPEN_REQUESTS.md`, `Documentation/VERCEL_SETUP.md`, `db/local-test/README.md`, `DEVCOLLAB.md`
- Hosted changes: none; all migration installation and behavior checks were explicitly rolled back
- Status: code-complete and rollback-rehearsed; migrations `0010`–`0014`, browser verification and the full hosted RLS suite remain open

### 2026-08-31 — Timi + Codex

**Completed the next actionable Phase 5 deliverable: promote a conversation to
a governed document, and closed the adjacent document-binding security gap.**

Worked exclusively on `Timi-Dev`. Migration
`0015_thread_document_promotion.sql` adds an authenticated participant-only RPC
that creates a normal owned Markdown document and, for a Team, its Viewer grant
in one database transaction. Direct-message promotions remain owner-only because
DMs are never permission groups. The conversation page now offers a compact
title-and-tags form; the server snapshots the complete thread in pages rather
than copying only the 100-message display window, writes it to the existing
private bucket, cleans the object up if registration fails, and schedules the
existing ingestion entry point. No retrieval, answering or RAG implementation
was changed.

The snapshot preserves authors, timestamps, edit markers, retraction tombstones
and reply ancestry. It does not copy governed document-reference cards, whose
titles may be visible to the promoter but not the Team receiving the snapshot.
Message bodies, names, titles and Team labels are escaped so Markdown or raw
HTML from chat cannot reshape the promoted document.

The migration also fixes a pre-existing authorization gap found during review.
An authenticated user could previously insert a document row pointing at a
different private storage path, or an Editor could update `owner_id` and become
the owner. A private database trigger now requires the owner/document/file path
binding on insert, makes file-binding columns immutable, and permits ownership
transfer only to an administrator. The existing administrator transfer workflow
continues to work.

The live hosted schema remains on migrations `0001`–`0009`. The current chat
source queries `parent_id`, `retracted_at`, collaboration tables, Team columns,
Team grants, document references and the promotion RPC introduced across
`0011`–`0015`; deploying code before the database would fail at runtime.
`PROJECT_STATUS.html`, `OPEN_REQUESTS.md` and `VERCEL_SETUP.md` now state the
hard deployment order: apply the complete reviewed `0010`–`0015` sequence,
deploy the matching application, then browser-test. No migration was deployed.

The attribution audit found zero `Timi` references in `PROJECT_STATUS.html` or
its generated public copy. Personal work attribution remains here only. The
status page now reports 70 of 81 deliverables Built, 151 passing tests and 112
executable permission assertions.

Migrations `0010`–`0015` parse-installed together on hosted PostgreSQL inside
`BEGIN`/`ROLLBACK`. A separate real-role rehearsal proved Team inheritance,
immediate withdrawal after member removal, DM isolation, non-member
administrator denial, Editor ownership-escalation denial and forged
storage-binding denial. Every transaction rolled back; no hosted schema or data
change persisted. Lint, typecheck, all 151 tests, schema parity and the Next.js
16 production build pass.

- Files: `supabase/migrations/0015_thread_document_promotion.sql`, `db/portable-schema.sql`, `db/local-test/01_permission_boundary.sql`, `src/lib/types/database.ts`, `src/modules/chat/actions.ts`, `src/modules/chat/promotion.ts`, `src/modules/chat/README.md`, `src/app/(app)/messages/[threadId]/page.tsx`, `src/app/(app)/messages/[threadId]/promotion-form.tsx`, `tests/thread-promotion.test.ts`, `PROJECT_STATUS.html`, `README.md`, `Documentation/TEAM_COMMUNICATION.md`, `Documentation/OPEN_REQUESTS.md`, `Documentation/VERCEL_SETUP.md`, `db/local-test/README.md`, `DEVCOLLAB.md`
- Hosted changes: none; all migration installation and behavior checks were explicitly rolled back
- Status: code-complete and rollback-rehearsed; migrations `0010`–`0015` must precede application deployment, and browser verification plus the full hosted RLS suite remain open

### 2026-08-31 — Timi + Codex

**Completed the next incomplete Phase 5 deliverable: live chat delivery and
quiet in-app notifications.**

Worked exclusively on `Timi-Dev`. Migration
`0016_chat_realtime_notifications.sql` adds `chat_messages` and the new
`chat_notifications` table to Supabase Realtime with idempotent publication
checks. The browser treats socket payloads only as invalidation signals and
re-runs the ordinary server queries, so RLS and the full sender, mention,
reaction, version and governed-reference projections remain authoritative.
New messages, edits and retractions now update the conversation, inbox and
navigation counts without polling.

Notifications are durable but deliberately quiet: only mentions and replies
create them. They copy no message body or permission-sensitive title, collapse
a reply-plus-mention for the same message into one row, exclude self-events,
link to the exact retained message and are selectable or markable only by their
recipient. Their RLS policy also re-checks conversation access, so removing a
person from a closed Team immediately hides its historical notifications.
Authenticated callers have no insert or delete privilege and can update only
`read_at`; an immutable-identity trigger provides a second database guard.

The pass also closed a read-receipt race found during review. Previously the
page fetched messages and then wrote `now()`, which could mark a message that
arrived between those operations as read before it was rendered. The new
`mark_chat_thread_read` RPC advances monotonically only through the ID of the
last message the page actually displayed.

No retrieval, answering, embedding or RAG implementation was changed. The
provider recommendation remains configuration-only and real AIC documents
must not be sent to unpaid Gemini services without the required privacy
approval.

The complete migration chain `0010`–`0016` parse-installed successfully on
hosted PostgreSQL inside `BEGIN`/`ROLLBACK`; no hosted schema or data change
persisted. A later optional behavior rehearsal lost the MCP transport before
returning and is not counted as evidence; its uncommitted transaction was
discarded on disconnect. The full destructive local RLS harness could not run
because this session has no `LOCAL_DB_URL`, so live two-browser and full RLS
verification remain explicit deployment gates.

Lint, typecheck, all 155 tests, schema parity and the Next.js 16 production
build pass. `PROJECT_STATUS.html` and its public artifact contain no personal
work attribution and now report 71 of 81 deliverables Built. The deployment
gate was extended accordingly: migrations `0010`–`0016` must be applied
before the matching chat build is deployed.

- Files: `supabase/migrations/0016_chat_realtime_notifications.sql`, `db/portable-schema.sql`, `src/lib/types/database.ts`, `src/modules/chat/actions.ts`, `src/modules/chat/queries.ts`, `src/modules/chat/realtime-refresh.tsx`, `src/modules/chat/README.md`, `src/app/(app)/layout.tsx`, `src/app/(app)/notification-center.tsx`, `src/app/(app)/messages/[threadId]/page.tsx`, `src/app/(app)/messages/[threadId]/conversation-view.tsx`, `tests/chat-realtime-notifications.test.ts`, `PROJECT_STATUS.html`, `README.md`, `Documentation/TEAM_COMMUNICATION.md`, `Documentation/OPEN_REQUESTS.md`, `Documentation/VERCEL_SETUP.md`, `db/local-test/README.md`, `DEVCOLLAB.md`
- Hosted changes: none; the successful migration rehearsal was rolled back, and the disconnected optional rehearsal could not commit
- Status: code-complete and rollback-rehearsed; migrations `0010`–`0016` must precede application deployment, with browser verification and the full hosted RLS suite still open

### 2026-09-01 — Timi + Codex

**Reconciled the latest upstream release and completed every immediately
actionable open deliverable phase by phase, without changing RAG.**

Worked exclusively on `Timi-Dev`. The branch now includes the latest upstream
multi-file page-wide drag/drop uploader, private server-side Word/Excel/
PowerPoint previews and proven free provider configuration. The overlap was
resolved by keeping those improvements while adding a persistent staged upload
queue: every file is stored in IndexedDB before network work, each completed
ticket/upload stage is retained, reconnect resumes sequentially, and document
finalization is idempotent. A failed transfer no longer discards successful
files or silently loses the remaining one.

Migration `0017_offline_document_leases.sql` adds an owner-only offline veto and
auditable per-user/per-device renewable 30-day leases. Grant and batch-
revalidation RPCs verify the active caller and current document read permission;
owner veto, permission loss and expiry retain explicit revocation reasons.
Authenticated clients cannot forge, alter or erase lease rows. The application
uses short-lived signed URLs, IndexedDB document bytes, reconnect/expiry/sign-
out purge, an offline library, a web manifest and a narrowly scoped service
worker. The worker caches only the offline shell and immutable framework assets;
authenticated HTML, APIs, signed URLs and document bytes are excluded.

PDF comments now support selected-passage anchors without touching the RAG
pipeline. A permission-checked endpoint uses the already-installed PDF parser
to return bounded page text; selecting within one page fills the existing page
and quote fields. The native visual preview remains available, and scanned PDFs
state that OCR is required. No OCR or RAG implementation was added because
those remain sample-dependent and/or reserved work.

The project status is derived from its rows and now reports 79 of 82 tracked
deliverables Built, with one hosted-security item In progress, one evidence-
dependent critical-fix item Not started and one representative-document item
waiting on Bishop. Personal attribution remains out of `PROJECT_STATUS.html`
and its public artifact. A separate phase-completion report lists everything
done, everything not done and the external restriction for each phase.

TypeScript, ESLint, all 176 tests, schema parity and the Next.js 16 production
build pass. The local permission harness now contains 125 assertions, including
offline veto, forgery denial, expiry, revocation and administrator metadata-
only access, but the new assertions did not execute because no approved
PostgreSQL development target is available. No hosted database or production
application change was made. Migrations `0010`–`0017` must be applied in order
before deploying this application build; hosted RLS, two-browser Realtime,
offline reconnect and representative-document verification remain explicit
deployment gates.

- Files: `supabase/migrations/0017_offline_document_leases.sql`, `db/portable-schema.sql`, `db/local-test/01_permission_boundary.sql`, `src/lib/types/database.ts`, `src/modules/offline/*`, `src/app/api/offline/revalidate/route.ts`, `src/app/api/documents/[id]/offline/route.ts`, `src/app/offline/page.tsx`, `src/app/manifest.ts`, `public/sw.js`, `src/app/(app)/dashboard/upload-document.tsx`, `src/app/api/documents/route.ts`, `src/modules/documents/pdf-preview-text.ts`, `src/modules/documents/preview-selection.ts`, `src/app/api/documents/[id]/preview-text/route.ts`, `src/app/(app)/documents/[id]/*`, `tests/offline-access.test.ts`, `tests/pdf-passage-comments.test.ts`, `PROJECT_STATUS.html`, `public/status.html`, `README.md`, `Documentation/OFFLINE_ACCESS.md`, `Documentation/TEAM_COMMUNICATION.md`, `Documentation/OPEN_REQUESTS.md`, `Documentation/DATABASE_DECISION.md`, `Documentation/PHASE_COMPLETION_2026-09-01.md`, `DEVCOLLAB.md`
- Hosted changes: none; migration `0017` was not applied and no destructive hosted verification ran
- Status: code-complete and production-build clean; migrations `0010`–`0017`, hosted permission/browser verification, representative AIC samples, privacy approval and evidence-driven critical fixes remain open
