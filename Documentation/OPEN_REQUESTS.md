# What remains open

The Supabase project exists, migrations `0001`–`0009` are applied, the
application is deployed, and member authentication has been exercised against
Supabase. Migrations `0010_security_hardening.sql` through
`0014_permission_aware_document_references.sql` are built and passed transactional hosted
rehearsals, but have not been deployed because this project has no Supabase
development branch. This file tracks the work that remains
unverified or requires an AIC decision.

The backend choice is settled in [`DATABASE_DECISION.md`](./DATABASE_DECISION.md):
Supabase is the current database, auth and storage provider; the portable schema
keeps Neon or plain Postgres available as a future exit.

## Verification still required

### 0. Approve a safe hosted-database target

The MCP audit found no Supabase development branches. Before migrations `0010`&ndash;`0014`
or the destructive hosted RLS suite runs, either create a development branch or
explicitly approve the main hosted project as the target. The RLS suite creates
and deletes throwaway users and data, so the development branch is preferred.

### 1. Run the live permission-boundary suite

`npm run verify:rls` has not been run against the development Supabase project.
It creates throwaway users and objects, so it must never target production. This
proves Supabase Auth, PostgREST, Storage and RLS deny access in the hosted
environment rather than only in the local Postgres harness.

### 2. Complete the deployed browser flow

Walk the full flow with two accounts:

1. Invite a member and complete the invitation redirect.
2. Sign in, change a password and exercise password recovery.
3. Upload an invented or sanitized document and wait for indexing.
4. Share it and confirm the second account can open and search it.
5. Ask a question and inspect the source citation.
6. Revoke access and confirm the document and its passages disappear.
7. Delete the test document and confirm its stored bytes are removed.

### 3. Test representative AIC formats

The parsers support PDF, DOCX, XLSX, PPTX, TXT, Markdown and CSV in code, but
they have not been validated against the files AIC actually circulates. Five or
six representative samples are needed. Until provider privacy is approved and
company-controlled accounts are active, use sanitized copies containing no
confidential AIC material.

If the real files are scans or photographs without a text layer, they need OCR,
which is deliberately outside the current beta.

## Decisions only AIC or Bishop can make

### AI provider and privacy

External answer and embedding providers receive selected passages or document
chunks. AIC must approve the provider, account type, retention terms and whether
real documents may be sent. A local Ollama deployment keeps content on the
machine but cannot be reached from a normal Vercel deployment.

### Staff email domain

Confirm the email domain staff will use and whether invitations should be
restricted to it.

### Product name

The working name is **AIC Documents**. Confirm or replace it before the public
demonstration.

## Answered decisions

- **Platform roles:** administrator and member. There is no student/tutor
  hierarchy. Document-level roles provide viewer, commenter, editor and owner
  behavior; see [`ROLE_MODEL.md`](./ROLE_MODEL.md).
- **Current backend:** Supabase. Neon remains a tested migration target, not a
  second live backend.

## Candidate work after verification

Use verification results to choose the next work rather than extending the beta
only to keep building.

| Candidate | Why it may matter |
| --- | --- |
| Retrieval re-ranking | Improves answer quality once real failures are measurable |
| Audit logging | Preserves operational history before real documents enter the system |
| Indexing monitoring | Makes failed ingestion visible at useful volume |
| Document comparison and structured extraction | Extends the intelligence layer |
| Full Teams model | Implements open/closed teams, membership governance and team grants on top of the retained conversations now built |
| Offline access | Adds leased cached reading, queued upload and revocation checks |

The last two have complete design documents but remain outside the original
three-week beta.
