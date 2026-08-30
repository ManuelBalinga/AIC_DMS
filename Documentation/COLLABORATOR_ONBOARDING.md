# Onboarding prompt for a new collaborator

Send the block below to anyone joining the project. They paste it into their
first chat with their AI assistant. It gives the assistant enough context to
work without reading the whole repository first, and tells it how to use
`DEVCOLLAB.md`.

Before sending it, make sure the person actually has access:

1. GitHub — add them as a collaborator on `ManuelBalinga/AIC_DMS`
   (Settings → Collaborators). The repository is private.
2. Supabase — invite them to the project if they need to see the database.
   They do not need this to read code or run the test suite.
3. Environment — they need their own `.env.local`. Send them
   `Documentation/DEPLOYMENT.md`, which lists every variable. **Do not send
   them key values over chat.** They fetch their own from the Supabase and
   provider dashboards.

---

## The prompt — copy everything below this line

I'm joining a project called **AIC_DMS**. It's an intelligent document
management system for AIC — documents live in one controlled place instead of
scattered across WhatsApp and email, and you can ask questions in plain English
and get answers cited back to the source document and page.

**Stack:** Next.js 16 (App Router, TypeScript, Tailwind v4), Supabase for
Postgres + Auth + Storage, pgvector for semantic search, deployed on Vercel.
The repo is `ManuelBalinga/AIC_DMS`.

### Before you write any code, read these, in this order

1. **`DEVCOLLAB.md`** (repo root) — the contribution log. Read the last few
   entries. It tells you what changed recently and *why*, which is the part a
   diff never captures. It also carries the rules for writing to it. Read those
   rules; they apply to you.
2. **`PROJECT_STATUS.html`** (repo root) — every deliverable and whether it is
   built or verified.
3. **`AGENTS.md`** and **`CLAUDE.md`** — project conventions.
4. Whichever file in `Documentation/` covers what you're about to touch.

### Two things about this project that are easy to get wrong

**Permissions live in the database, not in application code.** Every table has
Row Level Security. The two retrieval functions are `SECURITY INVOKER`, so
Postgres strips out passages the signed-in person cannot read *before* the
application ever sees them. This is deliberate: it means a future change cannot
leak a document by forgetting a `where` clause, because the clause was never in
that layer to forget.

So: **do not add permission filters in TypeScript.** If something needs a new
permission rule, it goes in a migration as a policy. And be careful — RLS fails
*silently*. A wrong policy returns fewer rows rather than raising an error, so a
broken permission looks like an empty page, not a stack trace. `npm run
verify:rls` exists for exactly this.

**"Built" and "verified" are different words here.** Built means code-complete
and passing checks. Verified means it actually ran against the real Supabase
project. The status page counts them separately and that has been kept honest.
Don't blur them.

### How to record what you do

After any meaningful change, **append an entry to the bottom of
`DEVCOLLAB.md`** — never edit or reorder anyone else's entry. The format is in
the file. Attribute it as `<my name> + <you, the assistant>`.

Write the entry in the same turn as the work, not at the end of the session.
And `git pull` before you write it — two assistants appending to one file is the
reliable way to create a merge conflict. If you do hit a conflict in that file,
**keep both entries** and order them by date. Never resolve it by dropping one.

Record what *didn't* work too. "Tried X, it failed because Y" saves the other
pair from repeating it and is usually worth more than a clean success story.

If the status of a deliverable changed, update `PROJECT_STATUS.html` as well —
but that document is shared with the client and management, so it stays
impersonal. It says *what* is built. `DEVCOLLAB.md` says *who*. Keep names out
of the status page.

### Working agreements

- Branches are collaborator-specific: Timi works on `Timi-Dev`; Claude web work
  uses `Claude-Dev`. Never change or merge into `main` without explicit approval.
- Never commit `.env.local`. It's gitignored; keep it that way. Never paste key
  values into chat — read them from the environment.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS completely. Treat it like a database
  password. It must never be prefixed `NEXT_PUBLIC_`.
- Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` before
  you call a deliverable Built or commit it.
- `npm run verify:rls` creates and deletes throwaway users. Development project
  only — never point it at production.

Start by reading `DEVCOLLAB.md` and `PROJECT_STATUS.html`, then tell me where
things stand and what you think is worth picking up first.
