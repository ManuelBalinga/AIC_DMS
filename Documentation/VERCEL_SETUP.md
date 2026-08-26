# Putting AIC DMS online with Vercel

Written for someone who has never deployed a website before. Nothing here
assumes you know what a build, an environment variable or a redirect URL is —
each one is explained where it first comes up.

`DEPLOYMENT.md` is the reference version of this, covering every setting and
both environments. This file is the shortest path from "the code is on GitHub"
to "there is a web address my colleagues can open".

---

## What "deploying" actually means here

Right now AIC DMS only runs on a computer where somebody has typed `npm run
dev`. Close the laptop and it is gone. Deploying means handing the code to a
company that runs computers for a living, so that it is running all the time at
a web address.

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

## Step 0: clear away two half-made projects

**Do this first.** While setting this up I created two Vercel projects from a
tool that could not finish the job — it could create them, but the part that
connects a project to GitHub kept failing (Vercel's API answered "not found"
every time it tried to check, which is the same answer it gives me when I try to
read *anything* about your Vercel account — the access I was given can create
things but not read them back).

So there are almost certainly two empty projects sitting in your account that
are connected to nothing:

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
   one at the top, click the **⋯** menu on its right, and choose **Redeploy**.
   Anything whose name starts with `NEXT_PUBLIC_` is written into the site when
   the site is *built*, not read while it runs. Changing the value without
   rebuilding changes nothing at all — the old value is still baked in.

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

## Step 5: bring the database up to date

The live site now expects database tables that your Supabase project may not
have yet. Several migrations were written after you first set the project up.

Supabase → **SQL Editor** → **New query**. For each file below, in this exact
order: open it in GitHub, copy the whole thing, paste it into the editor, click
**Run**, and read the result before moving to the next.

```
supabase/migrations/0007_roles_and_comments.sql
supabase/migrations/0008_chat_and_context.sql
supabase/migrations/0009_direct_messages_are_never_indexed.sql
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
proves it cannot read a document, its extracted text, or its stored file. It has
been run against a local copy of the database and passes 45 checks there. It has
never been run against your actual project, because it needs the `service_role`
key and I must not be given that key.

Running it is one command from your own machine, with the key in `.env.local`:

```bash
npm run verify:rls
```

Do that against a *development* Supabase project, not the real one — it creates
and deletes throwaway user accounts while it runs.

Until it has passed, "the site is online" and "the site is safe to put real AIC
documents in" are two different statements, and only the first one is true.
