# Roles and the Team page

Design for expanding beyond the current two roles. **Not built** — this is the
specification, written so that implementation is mechanical once the open
questions at the end are settled.

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
| **Administrator** | Invite and remove people, change platform roles, see the Team page, manage any document | — |
| **Member** | Sign in, upload documents, own and share what they upload, use Ask | Invite anyone, change roles, reach the Team page |

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
trusted to rewrite it. **This role requires a comments feature that does not
exist** — see Scope, below.

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

### What has to change with it

The permission helpers become role-aware. Today there are two —
`can_read_document` and `can_manage_document`. They become three, and every
policy switches to the new ones:

```sql
can_read_document(doc, user)      -- unchanged: any grant, or owner, or admin
can_edit_document(doc, user)      -- new: role >= 'editor', or owner, or admin
can_manage_document(doc, user)    -- unchanged meaning: owner or admin only
```

`can_read_document` keeps its current definition, which means **the RAG layer
needs no changes at all** — retrieval already asks only "may this person read
this?", and that question's answer does not depend on the new roles. That is
the payoff of having put permissions in the database rather than in the
retrieval code.

**Migration is not destructive.** Every existing grant becomes a Viewer, which
is exactly what it means today. Nobody gains or loses access on the day this
ships.

---

## Scope: comments do not exist

Commenter is the only role here that needs a feature built before the role means
anything. It is not a small addition:

- a `document_comments` table with its own RLS policies
- comment threads on the document page, and resolving them
- who sees a comment — everyone with access, presumably, but that is a decision
- notification when somebody comments on your document, or it goes unread

That is a feature in its own right, comparable in size to the sharing panel.
**Recommendation: ship Viewer / Editor / Owner first**, and add Commenter with
the comments feature rather than shipping a role that silently does nothing.

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

**The last administrator cannot be demoted or removed.** Not currently
enforced — today's rule only stops you demoting *yourself*, so two
administrators can demote each other down to zero and nobody can ever invite
anyone again. This should be a database-level check, not a UI one.

**Removing someone raises a question the platform cannot answer alone.** People
own documents. Deleting the person cascades to their documents — which is
correct for a test account and catastrophic for a departing staff member.
Options: block removal until their documents are transferred; transfer
everything to the removing administrator; or keep the account as `deactivated`
so it can no longer sign in but still owns its files. **Recommendation: the
third.** Departure is not deletion, and the platform should not lose the
company's documents because somebody changed jobs.

---

## Open questions — these change the implementation

1. **Should administrators be able to read every document?** They can today.
   For an internal document platform this is worth re-examining: it means HR
   letters, salary reviews and personal files are readable by any administrator
   without the owner knowing. The alternative — administrators manage *access*
   but cannot *read* — is defensible and not much harder. It is a policy
   decision for AIC, not a technical one.

2. **Is Commenter in scope now?** It needs the comments feature. If not now,
   Viewer / Editor / Owner ship first and Commenter arrives with comments.

3. **What happens when someone leaves?** Deactivate, transfer, or block. This
   decides whether removal is a button or a workflow.

4. **Two platform roles or three?** Still open from the plan — the July design
   review described students, tutors and admin. If that training-centre model is
   meant to live in *this* platform rather than a separate one, this is the
   moment to say so, because it changes the platform-role layer entirely.
