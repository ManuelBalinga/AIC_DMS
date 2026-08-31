# Putting AIC DMS online with Vercel

Written for someone who has never deployed a website before. Nothing here
assumes you know what a build, an environment variable or a redirect URL is —
each one is explained where it first comes up.

`DEPLOYMENT.md` is the reference version of this, covering every setting and
both environments. This file is the shortest path from "the code is on GitHub"
to "there is a web address my colleagues can open".

---

## What "deploying" actually means here

AIC DMS is already deployed. This runbook explains how that deployment works,
how to reproduce it for a new environment, and how to recover it if the Vercel
project must be recreated.

**Vercel** is that company. It is made by the same people who make Next.js,
which is what this project is built with, so it needs almost no configuration.

Vercel is not a database and it is not a filing cabinet. It runs the *pages*.
Your documents, accounts and permissions all stay in **Supabase**, exactly where
they are now. Deploying does not move any of your data.

The free plan ("Hobby") is enough for this. It is genuinely free — no card.

---

## Before you start

You need three things open in browser tabs:

1. **GitHub** — where the code lives: `github.com/ManuelBalinga/AIC_DMS`
2. **Vercel** — `vercel.com`, signed in with the same GitHub account
3. **Supabase** — `supabase.com/dashboard`, your `aic-dms` project

And roughly twenty minutes. Most of it is copying four values from one tab into
another.

---

## Historical cleanup check

During the first deployment attempt, tooling created two possible empty Vercel projects from a
tool that could not finish the job — it could create them, but the part that
connects a project to GitHub kept failing (Vercel's API answered "not found"
every time it tried to check, which is the same answer it gives me when I try to
read *anything* about your Vercel account — the access I was given can create
things but not read them back).

If either obsolete shell still exists and is connected to nothing, it may be
removed after confirming it is not the live deployment:

- `aic-dms`
- `aic-dms-web`

They are not deployments. They are empty shells, and leaving them there will
confuse you later when you are looking for the real one.

1. Go to `vercel.com/dashboard`.
2. If you see either name, click it, then **Settings** (top of the project
   page), scroll to the very bottom, and click **Delete Project**. It asks you
   to type the project name to confirm.
3. Do the same for the other one.

If neither is there, nothing was created and you can move straight on.

---

## Step 1: import the repository

This is the step that connects Vercel to your code, so that every time you or I
push a change to GitHub, the live site updates by itself.

1. On `vercel.com/dashboard`, click **Add New…** → **Project**.
2. Vercel shows a list of your GitHub repositories.
   - If the list is empty or `AIC_DMS` is missing, click **Adjust GitHub App
     Permissions** (or **Configure GitHub App**) and give Vercel access to the
     repository. This is the step that was failing for my tooling.
3. Find **AIC_DMS** and click **Import**.
4. Vercel now shows a configuration screen. **Change nothing.** It has already
   worked out that this is a Next.js project, and its guesses are correct:
   - Framework Preset: `Next.js`
   - Build Command: `next build`
   - Root Directory: `./`
5. **Do not click Deploy yet.** Expand **Environment Variables** first — that is
   Step 2. Deploying without them produces a site where every page shows an
   error.

---

## Step 2: the four values the site cannot run without

An **environment variable** is a named value the code reads when it starts, kept
outside the code itself. Passwords and API keys live here so they are never
written into a file that gets committed to GitHub.

Four are required. Three come from Supabase; the fourth you will not know until
Step 4, so it gets a placeholder for now.

Open Supabase in the other tab: your project → **Project Settings** (the gear,
bottom left) → **API**.

| Name to type into Vercel | Where to find it in Supabase |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Project URL** — looks like `https://abcdefgh.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Project API keys → `anon` `public`** — a very long string |
| `SUPABASE_SERVICE_ROLE_KEY` | **Project API keys → `service_role` `secret`** — click *Reveal* first |
| `NEXT_PUBLIC_SITE_URL` | Type `https://placeholder.vercel.app` for now. Step 4 replaces it. |

For each one: type the name in the left box, paste the value in the right box,
click **Add**.

> ### The `service_role` key is the master key to everything
>
> The `anon` key is designed to be public — it is in the browser on every page,
> and the database's own rules decide what the person holding it may see. The
> `service_role` key is the opposite: it **ignores every one of those rules** and
> can read, change or delete every document and every account in the platform.
>
> So: paste it into Vercel and nowhere else. Not into a chat, not into an email,
> not into a file in the repository. If it ever ends up somewhere it should not,
> Supabase can issue a new one and the old one stops working.
>
> Note the name has no `NEXT_PUBLIC_` in front. That prefix is Next.js's
> instruction to *ship this value to the browser*. Adding it to this key would
> publish the master key on every page of the site.

Now click **Deploy**. It takes two or three minutes.

---

## Step 3: what you should see

When it finishes, Vercel shows a screenshot of your site and a web address like
`aic-dms-abc123.vercel.app`.

**Click it. You will see the login page.** That is correct — everything else in
AIC DMS is behind a login, on purpose.

**If instead you see a page saying "Application error":** that is almost always
one of the four values above being missing or mistyped. Vercel → your project →
the **Logs** tab shows the actual error, and this project writes an unusually
specific one: it names the exact variable it could not find.

---

## Things in the build log that look like problems and are not

A successful build still prints a lot of yellow. Two rules before chasing any of it:

1. **`npm warn` and `warning` never fail a build.** Only a line that says `Error:`
   does, and the build result at the top of the page says `Ready` or `Error`
   outright. Read that first.
2. **The failing line is usually the last one, not the loudest one.** Warnings
   appear during install, minutes before anything real happens.

### `npm warn allow-scripts … unrs-resolver@1.12.2`

Expected, and safe to leave exactly as it is.

Newer npm refuses to run packages' install scripts unless you have explicitly
allowed them — a reasonable default, since an install script is arbitrary code
running on your build machine. It prints this warning to tell you it declined.

The package it declined to run is worth following, because the chain is what
makes this a non-issue:

```
eslint-config-next  →  eslint-import-resolver-typescript  →  unrs-resolver
```

Three facts, each of which alone would settle it:

- **It is a lint tool, not part of the site.** It is a development dependency,
  and nothing in `src/` imports it.
- **`next build` does not run ESLint.** Next.js removed linting from the build
  step in version 16. Linting happens when *we* run `npm run lint`, which
  happens here and in the repository, not on Vercel.
- **The script was not doing anything anyway.** `unrs-resolver` ships a
  compiled binary per platform and npm installs the right one normally. The
  script is a fallback for the case where that fails; when it has not failed,
  it exits having done nothing.

It is the only package in the entire dependency tree with an install script, so
this warning is the whole of that category and there is nothing else behind it.

**Do not run `npm approve-scripts` to silence it.** That grants a package
permission to execute code on every future install, and the only reason to do
that is if something needs it. Nothing does. A warning you have understood is
better than a permission you did not need to grant.

---

## Step 4: tell the site its own address

Two systems need to know the real web address, and neither can guess it.

### 4a. Vercel

The invitation emails your colleagues receive contain a link back to the site.
`NEXT_PUBLIC_SITE_URL` is where that link points, and right now it says
`placeholder`.

1. Vercel → your project → **Settings** → **Domains**. Copy the address at the
   top — the short one, `aic-dms.vercel.app` rather than the long one with random
   characters. The long one changes with every deployment; the short one does not.
2. **Settings** → **Environment Variables** → edit `NEXT_PUBLIC_SITE_URL` →
   replace the placeholder with that address. No trailing slash.
3. **This is the part everyone misses.** Go to the **Deployments** tab, find the
   one at the top, click the **⋯** menu on its right, choose **Redeploy**, and
   **untick "Use existing Build Cache"** in the dialog that appears.

   Anything whose name starts with `NEXT_PUBLIC_` is written into the site when
   the site is *built*, not read while it runs. This is not a figure of speech:
   in the compiled output the getter reads

   ```js
   get supabaseUrl(){ return required("https://yourproject.supabase.co", "NEXT_PUBLIC_SUPABASE_URL") }
   ```

   — a hardcoded string, with no lookup left to perform. A site built before the
   value existed has `undefined` written into it permanently, and setting the
   value afterwards changes nothing until it is built again. Unticking the build
   cache removes the second way to get this wrong, which is Vercel handing you
   back the same stale bundle.

### Each variable is scoped to an environment

The likeliest reason a variable you can plainly see in the dashboard still reads
as missing. When you add one, three checkboxes decide where it applies —
**Production**, **Preview**, **Development** — and they are independent:

- The short address (`aic-dms.vercel.app`) is served by **Production**.
- A long address with random characters in it is a **Preview** deployment, built
  from a branch.

A variable ticked only for Production is genuinely absent from a preview build,
and the error will say so truthfully. Tick all three unless you have a reason
not to.

### 4b. Supabase

Supabase sends the sign-in and invitation emails, and it refuses to send people
to any address it has not been told about. Without this step every invitation
link fails.

Supabase → **Authentication** → **URL Configuration**:

- **Site URL**: `https://aic-dms.vercel.app` (whatever you copied above)
- **Redirect URLs**: click **Add URL** and add both of these:
  - `https://aic-dms.vercel.app/auth/callback`
  - `https://aic-dms.vercel.app/**`

Click **Save**.

---

## Not every variable needs a rebuild — only the `NEXT_PUBLIC_` ones

Worth knowing, because it decides whether a change takes effect immediately or
not at all, and the two kinds behave oppositely.

Built with a sentinel value in each and the compiled output inspected:

| | In the compiled output | Read when |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | the value appears as a **hardcoded string**; no `process.env` lookup survives outside the source map | build time — a rebuild is the only way to change it |
| `ANTHROPIC_API_KEY` | the value appears **nowhere**; five live `process.env.ANTHROPIC_API_KEY` reads survive | on every request |

So the AI keys, the embedding settings and `SUPABASE_SERVICE_ROLE_KEY` are read
fresh each time a request runs. You still redeploy after adding them on Vercel —
a deployment carries the environment configuration it was created with — but the
reason is bookkeeping rather than anything frozen into the bundle. For a
`NEXT_PUBLIC_` value the rebuild *is* the fix, and no amount of redeploying
without one will help.

The rule of thumb: `NEXT_PUBLIC_` means *this value is safe for the browser to
see*, and the only way to get a value into a browser is to write it into the
files the browser downloads. That is the same fact from the other side.

---

## When the invitation email does not arrive

Expect this rather than treating it as a fault. Invitations go out through
Supabase's built-in email service, which is rate-limited and documented as not
for production use — mail lands in spam, or never leaves.

The fallback creates the account by hand, and works because of a trigger rather
than by luck:

1. **Invite them in the app first** (Team → invite), even if the email fails.
   That writes a pending row in `invitations` carrying the role you chose.
2. Supabase → **Authentication** → **Users** → **Add user**. Tick *Auto Confirm
   User*, set a password, and give it to them directly.
3. `on_auth_user_created` fires on the new `auth.users` row and creates their
   profile, reading the role from that pending invitation and falling back to
   `member` when there is none.

So the order matters only for the role: invite first and they arrive as what you
chose; skip step 1 and they arrive as a `member`, which an administrator can
change afterwards from the Team page.

The real fix, before anyone outside the test group is invited, is a proper mail
provider configured under Authentication → Emails → SMTP.

---

## Step 5: verify the database is up to date

The current Supabase project has migrations `0001`–`0009` applied. Migration
`0010_security_hardening.sql` is built and transactionally rehearsed but remains
pending until a development branch or explicit main-project approval exists.
For a new or recovered environment, use `npm run db:migrate`; the files below
are listed in order for verification.

Supabase → **SQL Editor** → **New query**. For each file below, in this exact
order: open it in GitHub, copy the whole thing, paste it into the editor, click
**Run**, and read the result before moving to the next.

```
supabase/migrations/0007_roles_and_comments.sql
supabase/migrations/0008_chat_and_context.sql
supabase/migrations/0009_direct_messages_are_never_indexed.sql
supabase/migrations/0010_security_hardening.sql
```

Each one is written to be safe to run twice, so if you are unsure whether you
already ran it, running it again does no harm.

**Read `0007` before you run it.** It is the one that takes a permission *away*:
after it runs, an administrator can still see that a document exists, who owns
it and who it is shared with — but can no longer open and read it unless the
owner has shared it with them. That is what you asked for, and it is written
down here because it is the kind of change that is unpleasant to discover by
accident.

---

## Step 6: check it actually works

Deploying successfully and *working* are different things. Walk this by hand:

1. Open the site. You should get the login page.
2. Sign in with your administrator account.
3. Upload a document. Watch its status; it should end at *Searchable by AI*
   (or *Stored, not indexed* if you have not added the AI keys — that is fine).
4. Go to **Team**, invite yourself at a second email address, and confirm the
   invitation email arrives and its link opens *your* site rather than
   `localhost`.
5. Accept it, set a password, and confirm that account sees an empty dashboard —
   **not** your document.

Step 5 is the one that matters most. If a brand-new account can see a document
nobody shared with it, stop and tell me, because that is the whole security
model failing.

---

## Two things still outstanding

**The AI on the Ask page is off until keys are added.** Ask works without them —
it falls back to keyword search — but it will not write answers. `DEPLOYMENT.md`
§2 lists the options, including a combination that is free and needs no card.
The reason it is not already switched on is that turning it on means AIC's
document text is sent to an outside company, and that is the decision waiting on
Bishop.

**The permission model has never been tested against the real Supabase.** There
is a command, `npm run verify:rls`, that signs in as a user with no access and
proves it cannot read a document, its extracted text, or its stored file. The
local suite contains 49 checks; 45 were recorded as passing before the four
direct-message exclusion checks were added. It has never been run against the
hosted project. Keep the service-role value in your own `.env.local`; never send
it through chat.

Running it is one command from your own machine, with the key in `.env.local`:

```bash
npm run verify:rls
```

Do that against a *development* Supabase project, not the real one — it creates
and deletes throwaway user accounts while it runs.

Until it has passed, "the site is online" and "the site is safe to put real AIC
documents in" are two different statements, and only the first one is true.
