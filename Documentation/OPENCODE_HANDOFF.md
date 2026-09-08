# Handoff to OpenCode — 8 September 2026

Everything needed to pick this up without the conversation that produced it.
Findings are from an end-to-end browser run against the real application and
the live Supabase project, not from reading code.

**Read [`DEVCOLLAB.md`](../DEVCOLLAB.md) before you start, and append to it when
you finish.** It is the shared log between Manuel + Claude and Timi + his
assistant, and it is the only place either pair learns what the other did.

---

## 1. The project in one paragraph

**AIC Documents** — an internal document platform for the Accra Innovation
Center, replacing document sharing over WhatsApp. Next.js 16 (App Router,
TypeScript, Tailwind v4), Supabase for Postgres + Auth + Storage, pgvector for
semantic search, 17 migrations all applied. Per-document permissions are
enforced by **Postgres Row Level Security, not application code** — the two
retrieval functions are `SECURITY INVOKER`, so the database removes forbidden
passages before the app sees them.

Two things about this codebase are counterintuitive and easy to break:

- **Do not add permission filters in TypeScript.** A new rule belongs in a
  migration as a policy. And RLS **fails silently** — a wrong policy returns
  fewer rows rather than raising, so a broken permission looks like an empty
  page, not a stack trace. `npm run verify:rls` is the only thing that tells
  you.
- **"Built" and "verified" are different words here.** Built means
  type-checked, linted, tested, building. Verified means it ran against the
  real system. `PROJECT_STATUS.html` counts them separately and that has been
  kept honest. Do not blur them.

Current state: **223 tests pass, lint and typecheck clean, production build
clean.** `Claude-Dev` and `main` are level at `dcb16ad`.

---

## 2. How the testing was done, so you can repeat it

Python Playwright, following the `anthropics/skills` `webapp-testing` skill.

```bash
python -m ensurepip --upgrade        # pip was missing on this machine
python -m pip install playwright     # uses installed Chrome via channel="chrome"

# Two disposable accounts, then the run:
node e2e-accounts.mjs                # writes e2e-accounts.json (gitignored)
python "<skill>/scripts/with_server.py" \
  --server "npx next start -p 3100" --port 3100 --timeout 120 \
  -- python e2e-recon.py http://localhost:3100
```

`e2e-recon.py` and `e2e-verify.py` are in the repo root. They are
**reconnaissance scripts, not a test suite** — they record what happens, they
do not assert. Turning them into an asserting suite is the second prompt in §8.

**Two traps that cost time. Both were the test's fault, not the app's:**

1. `wait_for_load_state("networkidle")` returns while the sign-in button still
   reads *"Signing in…"*. The Supabase round trip and the redirect that follows
   are two separate waits. Use `page.wait_for_url(lambda u: "/login" not in u)`.
   Without it, a screenshot shows the login form and reads as a broken login.
2. `with_server.py` reports ready as soon as the port accepts a connection, but
   `next start` takes ~25s to serve its first request. Worse, **a stale server
   from an earlier run holding port 3100** produces the identical symptom. Kill
   the port holder by PID before each run.

Because of those two, an early pass reported "sign-in broken" and "upload
control missing". Both were false. Anything below marked **verified** was
re-checked after the page had settled.

---

## 3. What is confirmed working — do not re-investigate

| Behaviour | Evidence |
|---|---|
| Upload of a file **whose name contains spaces** | Verified end-to-end through the real UI. This was the production failure ("Could not save the document record"), fixed in `aa69575`. |
| Permission boundary in the browser | A second signed-in member, granted nothing, **cannot see** the owner's document. |
| All five signed-in routes load | `/dashboard`, `/ask`, `/messages`, `/offline`, `/account` — no error page. |
| Console cleanliness | **0 console errors** across the whole run. |
| Heading, landmarks, skip link | `h1` present, one `main`, two `nav`, skip link present. My earlier "missing h1" reading was mid-hydration and is **wrong**. |

---

## 4. Issues found — ordered, each with its exact location

### 4.1 `/offline` has no page title

**Where:** `src/app/offline/page.tsx` — no `metadata` export at all.

**Symptom:** the browser tab reads `AIC Documents`, where every other route
reads `X | AIC Documents`. Verified live.

**Why it matters:** this is the page a member lands on when their connection
drops in the field — the exact moment they are most likely to have several tabs
open and need to find the right one. It is also the page whose name a screen
reader announces on load.

**Fix:** add `export const metadata = { title: "Offline | AIC Documents" };`

---

### 4.2 The Messages title uses a different separator from every other page

**Where:** `src/app/(app)/messages/page.tsx:17`

```ts
export const metadata = { title: "Messages · AIC Documents" };
```

The separator is `·` (U+00B7 MIDDLE DOT, bytes `M-BM-7`). Every other page uses
`|`:

- `Documents | AIC Documents`
- `Ask | AIC Documents`
- `Your account | AIC Documents`
- `People | AIC Documents`

**Fix:** change `·` to `|`. Trivial, but titles are the one piece of UI that
appears outside the app, in tab strips and history, so inconsistency shows.

---

### 4.3 Two identical "Sign out" buttons in the accessibility tree

**Where:** `src/app/(app)/layout.tsx:117` and `src/app/(app)/layout.tsx:152` —
`<SignOutButton />` rendered twice.

**Symptom:** the rendered DOM contains **two** buttons labelled "Sign out".
Confirmed by enumerating every button on `/dashboard`:

```
['Sign out', 'Sign out', 'Upload documents']
```

**Why it matters:** almost certainly one for the desktop rail and one for the
mobile disclosure, hidden from each other by CSS. CSS hiding does not remove an
element from the accessibility tree unless it is `display:none` or
`aria-hidden`. A screen-reader or keyboard user meets the same control twice
and cannot tell which one they are on.

**Fix:** confirm how each is hidden. If either uses `visibility`, `opacity`, or
off-screen positioning, it is still announced — render one conditionally, or
mark the inactive one `aria-hidden="true"` with `tabindex="-1"`. **Check before
changing:** if both are genuinely `display:none`-gated at their breakpoints,
this is a non-issue and should be closed as such rather than "fixed".

---

## 5. Pending deliverables, from `PROJECT_STATUS.html`

Headline today: **90 of 93 built, 2 in progress, 1 waiting on Bishop.**

### In progress — you can move these

| Deliverable | What remains |
|---|---|
| **Deploy beta** | Code is ready; the production build is clean and all 17 migrations are applied. Whether it is deployed **cannot be confirmed** — see §7. |
| **Fix critical issues** | One found and fixed (a rate-limited embedding provider took Ask down entirely instead of degrading to keyword search). The three issues in §4 belong here. |

### Blocked on AIC or Bishop — do not invent answers

| Question | Why it blocks |
|---|---|
| Which document types does AIC circulate, with sample files? | Sets the accepted upload list and which parsers are needed. |
| Which LLM provider is acceptable on privacy grounds? | Cost is solved (Gemini embeddings + Ollama Cloud, free tiers, proven). **Privacy is not.** Real AIC documents must not go through personal or unapproved free-tier accounts. |
| What email domain will team accounts use? | Needed before invitations go out. |
| What is the final product name? | "AIC Documents" is a working name only. |
| Test with representative AIC documents | Needs real sample files. |

---

## 6. **Required: update `PROJECT_STATUS.html` when you finish**

This is a standing project convention, not a preference. From `AGENTS.md`:

> `PROJECT_STATUS.html` is the shared status document — the one Manuel and
> whoever is building both read. It is not a report written at the end; it is
> expected to be accurate at every commit.

**When you finish any of the work above, in the same commit as the work:**

1. Move the deliverable's row to its new state.
2. **Update the counts in Overall progress and the progress bar.** They are
   derived from the rows and drift silently if only the rows change. Today's
   numbers are 90 / 93, 2 in progress, 1 needs Bishop.
3. Keep the built-versus-verified distinction. If you fixed something but did
   not run it against the live system, it is **Built**, not verified.
4. **Put no personal names in `PROJECT_STATUS.html`.** It is shared with Bishop
   and management and stays impersonal. Attribution goes in `DEVCOLLAB.md`.
   This has been violated once and corrected; please do not reintroduce it.
5. Append a `DEVCOLLAB.md` entry attributed `Manuel + OpenCode`, at the bottom,
   never editing anyone else's entry. Record what did **not** work too.

---

## 7. Things outside the code you should not be surprised by

- **Vercel is unreachable from tooling.** A project named `aic-dms` exists but
  sits in an account scope the connected token cannot read: `list_projects`
  returns empty, `create_git_project` returns 409 "already exists", and
  `list_deployments` returns 403. Deployment is dashboard work until that scope
  is fixed. Not a code problem.
- **`NEXT_PUBLIC_SITE_URL` is `http://localhost:3000`.** It is inlined at build
  time, so changing it needs a rebuild, not a restart. Until it names the real
  deployment, **every invitation email sends a link that only works on the
  machine that sent it.**
- **Logging exists now** (`src/lib/log.ts`, `src/instrumentation.ts`). One wide
  JSON event per request, request ids propagated in `src/proxy.ts`, and
  `onRequestError` writes React's error digest beside the real cause — so the
  reference on the error page is finally findable. `commit` and `region` read
  `VERCEL_*` and are `null` until deployed. **Do not log document text, storage
  paths, emails or tokens**; the redaction list in `log.ts` is deliberate and
  tested.

---

## 8. Prompts you can paste

**To fix the three issues in §4:**

> Read `Documentation/OPENCODE_HANDOFF.md` §4. Fix issues 4.1 and 4.2 directly.
> For 4.3, first check how each `SignOutButton` in `src/app/(app)/layout.tsx` is
> hidden at its breakpoint — if both are `display:none`-gated the issue does not
> exist and you should say so rather than change code. Run `npm run typecheck`,
> `npm run lint` and `npm test` before committing. Then update
> `PROJECT_STATUS.html` per §6 of the handoff, including the counts and the
> progress bar, and append a `DEVCOLLAB.md` entry as `Manuel + OpenCode`.

**To turn the reconnaissance into a real test suite:**

> `e2e-recon.py` and `e2e-verify.py` in the repo root record behaviour but
> assert nothing. Turn them into an asserting suite covering: sign in, upload a
> file whose name contains spaces, confirm a second member cannot see it, share
> it, confirm they now can, revoke, confirm it disappears. Read
> `Documentation/OPENCODE_HANDOFF.md` §2 first — there are two timing traps that
> will otherwise produce false failures. Create disposable accounts per §2 and
> delete them afterwards. Do not commit `e2e-accounts.json`; it is gitignored.

**To close out the deployment row:**

> `PROJECT_STATUS.html` has "Deploy beta" as In progress because deployment
> could not be confirmed. Read `Documentation/OPENCODE_HANDOFF.md` §7. Determine
> from the Vercel dashboard whether `aic-dms` is deployed and on which commit,
> then set the row to what is true — and set `NEXT_PUBLIC_SITE_URL` to the real
> URL, remembering it is inlined at build time and needs a rebuild.

---

## 9. House rules

- Branch: `Claude-Dev`. Merge to `main` when finished.
- Never commit `.env.local` (gitignored, keep it that way). Never paste key
  values into chat.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. Treat it as a database
  password; never prefix it `NEXT_PUBLIC_`.
- `npm run verify:rls` creates and deletes throwaway users — development target
  only.
- Run `npm run lint`, `npm run typecheck` and `npm test` before every commit.
