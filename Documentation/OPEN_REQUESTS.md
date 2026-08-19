# What I need from you

Everything I can build without a database is built. This is what is left, and
who it is waiting on.

The backend question itself is settled in
[`DATABASE_DECISION.md`](./DATABASE_DECISION.md) — Supabase now, Neon as a
proven exit rather than a starting point — and that document has the
step-by-step setup. This one is just the asks.

## Blocking verification

Nothing on `PROJECT_STATUS.html` has ever run against a real Postgres. Every
row marked **Built** is code-complete and unproven. These two items are what
convert the whole page from a plan into a status.

**1. A Supabase project, and its three values for `.env.local`**

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. `DATABASE_DECISION.md` §4 walks through creating
it, running the six migrations, and bootstrapping your administrator account.

> Send these privately — not in a git commit, not in a chat log. The
> service-role key bypasses every permission rule in the platform.

Once they exist, roughly forty minutes of work becomes possible that is not
possible now: run the migrations, run `npm run verify:rls` (the only thing that
turns the security model from a claim into a result), and walk the full flow —
invite, sign in, upload, watch indexing finish, share, ask, check a citation,
revoke, delete.

**2. Representative AIC documents — five or six real files**

The parsers were written against the document types the plan *names*, not
against files that actually circulate. Until real ones go through ingestion,
"supports PDF, DOCX, XLSX, PPTX" is an untested claim, and the summariser and
tagger have never seen real input either.

This is also the item most likely to produce surprises. If AIC's documents turn
out to be photographs of printed pages — which WhatsApp sharing makes very
likely — none of them will index at all, because that needs OCR and OCR is not
built. Better to learn that now than during the demo.

## Decisions only you or Bishop can make

**3. The LLM privacy question.** Answering a question sends document text to
Anthropic. It is the only point where AIC content leaves your control, and it
has been open since the first plan. Without an answer the platform still runs —
Ask degrades to keyword search, summaries and tag suggestions are skipped — but
that is the half of the product Bishop is most interested in.

**4. The email domain** for team accounts, and whether invitations should be
restricted to it.

**5. Two roles or three.** The plan says administrator / document owner / team
member. Your 27 July student-screen notes described students, tutors and admin.
If this platform is also meant to serve the training centre, `user_role` needs a
third value — cheap to add now, a migration once there is data.

**6. A platform name**, if you want one before the demo. Currently "AIC
Documents", in 13 places in code.

## What I can build next without any of the above

Phase 4 and Phase 5 are largely backend-agnostic, since they reuse the chunks
and embeddings ingestion already produces. In rough value order:

| Next | Why it is worth doing | Phase |
| --- | --- | --- |
| Re-ranking retrieved passages | The clearest remaining win for answer quality | 4 |
| Audit logging | Cannot reconstruct history retroactively — worth having *before* real documents go in | 5, §14 |
| Indexing-status dashboard, failed-ingestion monitoring | Becomes genuinely useful the moment real documents start failing | 5 |
| Document comparison, information extraction | Rounds out Phase 4 | 4 |
| Departments and permission groups | Commits to schema decisions, so item 5 above should be settled first | 5 |

My recommendation is to do these **after** a database exists rather than
before. Right now every one of them would add unverified code on top of
unverified code, and the ratio of built-to-proven is already the main risk on
this project. Say so if you would rather I keep building regardless — it is a
reasonable call if the backend is going to take a while.
