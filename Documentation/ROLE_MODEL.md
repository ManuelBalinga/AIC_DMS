# Roles and the Team page

Design for expanding beyond the current two roles. **Built in migration `0007`
and shipped 20 August** — this document is now the record of what exists and
why, not a proposal. The one part still outstanding is noted under *Comments*.

**Decisions taken by Manuel, 20 August**, recorded here because two of them
change existing behaviour rather than adding to it:

1. **Comments are in scope** — both on a document as a whole and anchored to a
   place inside it. Commenter is therefore a real role, not a placeholder.
2. **Administrators can manage access but cannot read documents** unless an
   owner grants them access like anyone else. This reverses current behaviour.
3. **Someone leaving deactivates rather than deletes.** See *Departure*, below.
4. **No student / tutor / training-centre roles.** This platform is corporate.
   The three-layer model from the July design review is out, permanently.

## The distinction the current design is missing

The roles asked for — owner, admin, editor, viewer, commenter — are not one
list. They belong to two different levels, and conflating them is the mistake
that makes permission systems unmaintainable:

| | Answers | Set by | Example |
| --- | --- | --- | --- |
| **Platform role** | What are you *in AIC?* | An administrator, on the Team page | Administrator, Member |
| **Document role** | What are you *on this file?* | The document's owner, when sharing | Owner, Editor, Commenter, Viewer |

"Administrator" is a platform role. "Editor" is a document role. They are not
alternatives to each other — a person has one platform role and a *different*
document role on every document shared with them. A Member can be Editor on one
document, Viewer on another, and have no access at all to a third.

The platform already works this way; it just has only one document role
(a grant, meaning "can read") and no name for it.

---

## Platform roles

Two, and deliberately not more.

| Role | Can | Cannot |
| --- | --- | --- |
| **Administrator** | Invite and deactivate people, change platform roles, see the Team page, see that any document exists and who can reach it, change its access | **Read any document's contents**, download it, or get AI answers from it — unless an owner grants them access like anybody else |
| **Member** | Sign in, upload documents, own and share what they upload, use Ask | Invite anyone, change roles, reach the Team page |

### The administrator change is not cosmetic

Before migration `0007`, `can_read_document` ended with an administrator clause,
so every administrator could read every document. Removing it was right for a
platform that may hold HR letters and salary reviews, and forced a distinction
the original schema did not make:

| An administrator needs to | Which means seeing |
| --- | --- |
| Know a document exists, to manage its access | The `documents` **row** — title, owner, who it is shared with |
| Read what it says | The **file bytes** and its `document_chunks` |

So the split is: administrators keep visibility of *metadata*, and lose it for
*content*. Three things follow automatically once `can_read_document` drops the
administrator clause, because all three already route through it:

- **Retrieval stops returning their chunks.** No code change in the RAG layer.
- **The download route refuses.** It already checks `can_read_document` before
  minting a signed URL.
- **Ask answers them from nothing**, and says so, exactly as it does for anyone
  else with no access.

That is the whole change on the read side: one clause, in one function. The
work is on the *write* side — `documents_select` must keep showing
administrators the row while `document_chunks_select` stops showing them the
text, which today are governed by the same helper.

**One consequence worth stating plainly to AIC:** after this change, an
administrator cannot recover a document nobody else can reach. If the only
owner is deactivated and never shared it, the file is still in storage and
still in the database, but no one in the platform can open it. That is the
correct trade for confidentiality, and it is the reason *Departure* below
deactivates rather than deletes.

**Why not a third platform role.** The obvious candidate is a "Guest" who cannot
upload — an auditor, an intern, an external reviewer. It is worth having, but it
is not worth a role: it is one boolean, `can_upload`. Adding a third role means
every policy, every check and every UI branch grows a third case forever. A flag
on the member row costs one column. Roles should be added when they change
*many* permissions at once; `can_upload` changes exactly one.

**Recommendation:** keep two roles, add `can_upload boolean not null default true`
when the need is real. Not before.

---

## Document roles

Four, strictly increasing — each includes everything below it.

| Role | Read | Ask about it | Comment | Edit details | Replace file | Share it | Delete |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **Viewer** | ● | ● | | | | | |
| **Commenter** | ● | ● | ● | | | | |
| **Editor** | ● | ● | ● | ● | ● | | |
| **Owner** | ● | ● | ● | ● | ● | ● | ● |

Ordering them matters more than it looks. A hierarchy means one comparison
answers every question — `role >= 'editor'` — instead of a lookup table that
grows quadratically and eventually disagrees with itself. Postgres enums compare
by declaration order, so this is free if the enum is declared in the right
sequence and expensive to retrofit if it is not.

### What each one is actually for

**Viewer** — the default when sharing. Read it, download it, ask the AI about
it. Cannot change anything. This is what today's grant already does.

**Commenter** — can attach comments without altering the document. The role
worth having for review: a colleague marks up a draft policy without being
trusted to rewrite it. Requires the comments feature specified below, which is
now in scope.

**Editor** — can change title, description and tags, and can replace the file
with a new version. Cannot share it onward and cannot delete it. That boundary
is the point: an editor improves a document, an owner decides who sees it.
Replacing the file re-runs indexing, so an editor can change what the AI
answers from — which is why Editor is a meaningful step up, not a cosmetic one.

**Owner** — exactly one per document, the person who uploaded it. Can do
everything including delete and transfer ownership. Not grantable to several
people; "co-owner" is Editor plus the sharing right, and if that turns out to
be needed it should be a fifth role rather than a second owner.

### Deliberately not roles

| Considered | Why not |
| --- | --- |
| **Downloader** (view but not download) | Real need, wrong shape. Someone who can see a document on screen can screenshot it — the control is theatre unless the file never reaches the browser. Better as a `watermark`/`no_download` flag on the document, honestly labelled as friction rather than security. |
| **Approver** | Belongs to a workflow feature (master plan Phase 8), not to access control. Approval is a *state a document is in*, not a thing a person is. |
| **Uploader** | Everyone who can upload owns what they upload. Nothing left for the role to mean. |

---

## How this maps to the database

Today `document_access` is a membership row — its existence *is* the permission.
The change is one column:

```sql
create type public.document_role as enum ('viewer', 'commenter', 'editor');

alter table public.document_access
  add column role public.document_role not null default 'viewer';
```

Owner stays where it is, as `documents.owner_id`. It is not a row in
`document_access`, because an owner is not granted access — they have it by
being the owner, and a row that could be deleted would make ownership
revocable by accident.

The enum omits `owner` on purpose: a value that must never appear in the column
is a value someone will eventually insert.

### What changed with it

The permission helpers became role-aware. The original two were
`can_read_document` and `can_manage_document`. They became three, and every
policy switched to the new ones:

```sql
can_read_document(doc, user)     -- CHANGED: any grant, or owner. No longer admin.
can_comment_on_document(doc, user) -- new: role >= 'commenter', or owner
can_edit_document(doc, user)     -- new: role >= 'editor', or owner
can_manage_document(doc, user)   -- unchanged: owner or admin. Access, not content.
```

`can_manage_document` keeps the administrator clause and `can_read_document`
loses it — that pair *is* the "manage access but not read" decision, expressed
in two functions rather than scattered through the policies.

**The RAG layer still needs no changes**, even though `can_read_document` now
means something different. Retrieval only ever asks "may this person read
this?" — it does not care how the answer is computed. Narrowing the answer to
exclude administrators propagates to retrieval, download and Ask for free. That
is the payoff of having put permissions in the database rather than in the
retrieval code, and it is worth more on a change like this than on an additive
one.

**Migration is not destructive.** Every existing grant becomes a Viewer, which
is exactly what it means today. Nobody gains or loses access on the day this
ships.

---

## Comments

In scope, at two levels, because they answer different needs:

| | Anchored to | Used for |
| --- | --- | --- |
| **Document comment** | The document as a whole | "This supersedes the March version" |
| **Placed comment** | A page, and optionally a selected passage | "This clause contradicts §4" |

### Schema

```sql
create table public.document_comments (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id) on delete cascade,
  author_id    uuid not null references public.profiles (id) on delete set null,
  parent_id    uuid references public.document_comments (id) on delete cascade,
  body         text not null check (length(trim(body)) > 0),
  -- Null for a document-level comment; set for a placed one.
  page_number  integer,
  quoted_text  text,
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

Three decisions embedded in that:

**Replies are the same table, via `parent_id`.** A separate replies table would
duplicate every policy and every query for no gain. One level of nesting only —
a reply to a reply is still a reply to the thread, which is how people actually
read them.

**`author_id` is `on delete set null`, not cascade.** A departing colleague's
comments are part of the document's history. Deleting the person must not
silently rewrite a review thread, leaving the remaining comments answering
questions nobody appears to have asked. The UI renders a null author as
"Former colleague".

**`quoted_text` stores the passage, not a character offset.** Offsets break the
moment an Editor replaces the file — silently, and pointing at the wrong text,
which is worse than pointing at nothing. Storing the quote means a comment can
still show what it was about, and the UI can say "this passage has changed"
when it no longer matches.

### Who can see and do what

```sql
-- Read: anyone who can read the document. Comments are not more private than
-- the thing they are attached to, and not less.
create policy document_comments_select on public.document_comments
  for select to authenticated
  using (public.can_read_document(document_id, (select auth.uid())));

-- Write: commenter and above.
create policy document_comments_insert on public.document_comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_comment_on_document(document_id, (select auth.uid()))
  );

-- Edit and delete: your own comment only. Not even the document owner may
-- rewrite somebody else's words -- they can resolve the thread instead.
create policy document_comments_update_own on public.document_comments
  for update to authenticated
  using (author_id = (select auth.uid()));
```

Resolving is the exception: the **document owner or the comment's author** may
resolve a thread. An owner needs to be able to close out review on their own
document without editing what anybody said.

Note what falls out of `can_read_document`: with administrators no longer able
to read documents, they cannot read the comments on them either. Consistent by
construction, with no separate rule to keep in step.

### Where it appears

- **On the document page** — a comment panel beside the preview, threads
  ordered by page then time, unresolved first.
- **In the preview** — for PDFs, a marker in the page margin. Selecting text
  offers "Comment on this passage", which fills `page_number` and `quoted_text`.
- **On the dashboard** — an unresolved-comment count on each document row, so a
  document waiting on you is visible without opening it.

### Built, and the one part that is not

Built: the table and its policies, threads with replies, document-level and
page-anchored comments, resolve and reopen, delete-your-own, and the
unresolved-thread badge on the dashboard. `quoted_text` is filled by pasting the
passage into the comment form.

**Not built: selecting text in the preview to comment on it.** The preview
shows a PDF in an `<iframe>` pointed at a signed storage URL, which is a
different origin — a page cannot read a selection inside it, and the browser's
built-in PDF viewer exposes no selection API to the embedding page. Doing this
properly means rendering the PDF in-page with pdf.js and building a text layer
over it: a document viewer, which is a project rather than a detail. Pasting
the passage is the honest interim, and it stores the same thing.

Also not in this pass, and each a feature in its own right: notifications,
@mentions, and comment search. None is needed for the role to mean something.

---

## Departure

**Decision: deactivate, do not delete.**

The question is what "remove someone" should do when that person owns
documents. Three options were on the table:

| Option | What happens | Why not |
| --- | --- | --- |
| **Delete the account** | `on delete cascade` removes their profile — and every document they own goes with it | Correct for a test account, catastrophic for a departing colleague. AIC loses company documents because somebody changed jobs. |
| **Block until transferred** | Removal is refused until an owner is nominated for each of their documents | Honest, but it turns an exit interview into a filing exercise, and the administrator doing it cannot read the documents to know who should get them |
| **Deactivate** ✅ | The account can no longer sign in. It still owns its documents, still appears as the author of its comments, still shows in sharing panels as the owner | — |

```sql
alter table public.profiles
  add column deactivated_at timestamptz;
```

**What deactivation means, precisely:**

- **Cannot sign in.** Enforced at the auth provider *and* in the session check,
  so an existing session dies at its next request rather than lingering.
- **Still owns their documents.** Nothing is deleted, nothing is orphaned,
  every sharing grant they made stays in force.
- **Shown as inactive** in the Team page and anywhere they appear as an owner,
  so a colleague can tell why nobody is answering.
- **Reversible.** Reactivating restores access. People come back, and contracts
  get extended.

**Ownership transfer is a separate, deliberate act.** An administrator can
transfer a deactivated person's documents to a named colleague — one at a time
or all at once — from the Team page's person detail view. It is not automatic,
because the right new owner is a judgement about the work, not about the org
chart.

**Deleting an account outright stays possible**, for genuine mistakes — a typo
in an invited address, a test account. The UI should require the account to own
zero documents first, which makes the destructive path available without making
it easy to reach by accident.
---

## The Team page

Today it does three things: invite, list members, change platform role. With
document roles it needs to answer a fourth question that nobody can currently
answer — *what does this person actually have access to?*

### Proposed structure

**1 · Invite** — unchanged. Email, platform role, send.

**2 · Pending invitations** — unchanged. Who has been invited, by whom, when,
with the option to withdraw.

**3 · Members** — the list, with per-person: name, email, platform role, and
**how many documents they can reach**. That last number is the useful addition.
Clicking a person opens:

**4 · Person detail** — new. Everything about one colleague on one screen:
- their platform role, changeable here
- every document shared with them, and at what role
- every document they own
- when they last signed in
- **Remove from platform**, which needs its own thinking (below)

The reason this screen is worth building: today, answering "what can Ama see?"
means opening every document one at a time. That is the question an
administrator actually asks — usually when somebody leaves, or when something
has been shared that should not have been.

### What the page must refuse to do

**You cannot demote yourself.** Already built, already enforced server-side.
Keep it.

**The last administrator cannot be demoted or removed.** Migration `0007`
enforces this with a database trigger on demotion and deactivation; it cannot be
bypassed by two administrators demoting each other until nobody can invite
anyone again. This is a database-level check, not a UI one.

**Removing someone raises a question the platform cannot answer alone.** People
own documents. Deleting the person cascades to their documents — which is
correct for a test account and catastrophic for a departing staff member.
Options: block removal until their documents are transferred; transfer
everything to the removing administrator; or keep the account as `deactivated`
so it can no longer sign in but still owns its files. **Recommendation: the
third.** Departure is not deletion, and the platform should not lose the
company's documents because somebody changed jobs.

---

## Settled

All four questions are answered — 20 August, by Manuel:

| Question | Answer |
| --- | --- |
| Should administrators read every document? | **No.** Manage access, not content. Unless an owner grants them access like anyone else. |
| Is Commenter in scope? | **Yes**, with comments at both document and passage level. |
| What happens when someone leaves? | **Deactivate**, with ownership transfer as a separate deliberate act. |
| Two platform roles or three? | **Two.** No student/tutor model — this platform is corporate. |

## Build order

Each step leaves the platform working, which matters because it is now in use:

1. **Document roles** — enum, column, `can_comment_on_document`,
   `can_edit_document`. Every existing grant becomes Viewer; nothing changes
   for anybody on the day it ships.
2. **Sharing UI** — pick a role when sharing, change it afterwards.
3. **Administrator read removal** — the one clause. Ships alone, because it is
   the only change here that *takes away* access, and it should be easy to
   identify if something unexpected follows.
4. **Comments** — table, policies, document panel, then passage anchoring.
5. **Deactivation and transfer** — profile column, session check, Team page.
6. **Last-administrator protection** — a database check, not a UI one.
