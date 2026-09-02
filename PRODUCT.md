# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff of the Accra Innovation Center (AIC) — an innovation and entrepreneurship
hub that runs programs such as internships, training, and cohorts. Two
platform-level roles exist today: an **administrator** (currently one person,
Manuel) who manages accounts and access, and **members** (currently two: Bishop
and Bobby) who upload, share, and search documents, message each other, and ask
questions over the shared document corpus.

Members genuinely lose connectivity at times — field visits, program sites,
travel — which is a real operating condition, not a hypothetical one, and it
shapes the offline-access design (see Operating Context).

## Product Purpose

Replace WhatsApp-based document sharing at AIC with a controlled internal
platform: private storage, per-document permissions, a RAG layer for asking
questions across accessible documents, and team messaging so that conversation
about those documents doesn't fall back into WhatsApp either. Success looks
like a document AIC can still find six months later, whose access is known and
can be taken back — none of which is true of a WhatsApp group.

## Positioning

The product's own framing of the problem, from its demo script: *"Right now a
document goes into a WhatsApp group and then it is gone — you cannot tell who
has it, you cannot take it back, and in six months nobody can find it. This is
the same document, in a place where all three of those are possible."*

The mechanism a neighboring product (WhatsApp, a shared drive) could not
truthfully copy: retrieval and messaging both key off the same Postgres
row-level-security policy that governs document access, so an AI-generated
answer can never be grounded in a document the asker isn't independently
permitted to open — and revoking access actually removes the document and its
indexed passages, not just a link.

## Operating Context

- **Connectivity is a real constraint, not a nicety.** Staff work with poor or
  no internet during field visits, program sites, and travel. This is why
  offline access — per-device leases, revalidation, purge on sign-out, an
  upload queue — was built as a first-class feature rather than a convenience
  layer.
- **Invitation-only.** There is no public sign-up. Every account exists because
  an administrator decided the person is staff.
- **No separate IT/support role.** Access management, invitations, and role
  changes happen through the same administrator account that also uses the
  product day to day.
- **What moves through the platform:** internal announcements, program
  materials (the one real document indexed today is an Industry Internship
  course outline), updates, and per-person or per-team file sharing — the
  categories of thing that used to move through WhatsApp instead.
  Messaging exists so discussion *about* those documents doesn't leak back into
  WhatsApp either, but a chat message can never itself carry a file — it may
  only reference a document that already went through the permission-checked
  upload path.
- **Retention is deliberate and durable.** Nothing is ever deleted from
  messaging. This is a corporate-evidence requirement, not just a technical
  choice: removal is a retraction (the record is tombstoned, not erased) and
  edits are versioned rather than overwritten, so the history stays trustworthy
  as a record of who said what.

## Capabilities and Constraints

**Confirmed functionality:** document upload and private storage (50&nbsp;MB
cap per file); per-document roles (viewer, commenter, editor, plus an owner);
platform roles (administrator, member); tagging, keyword, and semantic search;
RAG question-answering with citations to the source document and page;
per-user conversation memory; team messaging (teams and DMs, threaded replies,
mentions, reactions, permission-aware document references); offline document
access via revocable per-device leases; real-time notifications.

**Terminology / a durable distinction:** "administrator" is an access-management
role, not a content-access role — an administrator can grant or revoke access to
a document or a closed conversation without being able to read it. Reading and
managing are treated as separate powers throughout.

**Constraints that must hold going forward:**
- A message can never carry a file — only a reference to a document that
  already exists under the permission system.
- Retrieval and messaging must stay keyed to the same row-level-security policy
  that governs document access, so an answer can never surface content the
  asker isn't independently permitted to read.

**Explicitly undecided (needs AIC or Bishop, not invented here):**
- The final public-facing product name. "AIC Documents" (app/PWA name) and "AIC
  Internal Document Platform" (long form) are the working names used throughout
  the shipped code and docs, not yet confirmed as final.
- The staff email domain to use for invitations.
- Which AI provider is acceptable on privacy grounds for processing real AIC
  content. Until that's settled, only invented or sanitized documents are used
  in demos and testing, apart from the one real course-outline document already
  indexed.

## Brand Commitments

- Working name, already shipped: **AIC Documents** (app title, PWA short name),
  **AIC Internal Document Platform** (README / full name). Provisional — see
  the undecided product name above.
- Voice, from the platform's only user-facing copy so far (the sign-in screen):
  plain and direct, no marketing tone. *"Internal platform. Sign in to
  continue."* / *"Accounts are created by an administrator. There is no public
  sign-up."*

## Evidence on Hand

- One real AIC document is indexed on the platform: an Industry Internship
  course outline (PDF, 2026). Everything else used in demos or testing to date
  is invented or sanitized, pending AIC's privacy approval and
  company-controlled AI-provider accounts before broader use of real content.
- Three real accounts exist, created through the invitation flow: one
  administrator (Manuel) and two members (Bishop, Bobby).
- No testimonials, press, case studies, or usage benchmarks exist yet — future
  work must not fabricate them.

## Product Principles

1. **Reading and managing are different powers.** An administrator can grant or
   revoke access without ever being able to read the content itself — and the
   same split applies to messaging.
2. **Revocation must be real, not cosmetic.** Removing access removes the
   document and its retrievable passages, not just a visible link.
3. **Nothing is deleted; everything is retracted or versioned.** Messaging
   history is corporate evidence, so removal and edits are recorded, never
   erased.
4. **A message can never carry a file.** Chat may reference a
   permission-checked document; it may never become a second way to move a file
   around the permission system.
5. **Offline is a managed exception, not an escape hatch.** Access outside the
   live permission system is leased, revocable, and purged on sign-out —
   because AIC staff genuinely lose connectivity in the field, not as a
   theoretical edge case.

## Accessibility & Inclusion

No specific standard or user need has been established yet. Recorded as open
rather than invented; revisit if a requirement surfaces.
