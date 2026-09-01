# Phase completion report — 1 September 2026

This report follows the authoritative three-week deliverables in project-plan
§10 and acceptance criteria in §11, then records later agreed work separately.
“Built” means typecheck, lint, automated tests and production build are clean. It
does not mean a pending migration or browser workflow has been verified live.

## Phase 1 — Foundation

**Done:** all scoped implementation remains Built. The latest branch work adds
multi-file picking and page-wide drag/drop while preserving direct-to-private-
Storage upload, server-side metadata verification and retry-safe finalization.

**Not done:** hosted invitation redirect and password-recovery email/browser
verification. These require the deployed Auth/email configuration and a safe
test account flow; they cannot be proven from source code.

## Phase 2 — Document processing and management

**Done:** all scoped implementation remains Built. Word, Excel and PowerPoint
now have private in-process readable previews with allowlist HTML sanitization.
PDF passage selection uses a separate preview-text module and does not modify or
depend on RAG.

**Not done:** OCR for scanned documents. Representative AIC scans are required
to select and evaluate an OCR tool. Durable ingestion queues also remain a
later infrastructure enhancement rather than an immediate free-plan change.

## Phase 3 — Search and AI assistant

**Done:** the existing implementation remains Built. Provider probes have
proved Gemini `gemini-embedding-001` at 1536 dimensions and free Ollama Cloud
`gpt-oss:120b` streaming answers. Qwen 3.5 was not selected because the tested
Ollama Cloud endpoint places it on a paid tier.

**Not done:** the destructive hosted RLS suite, real-corpus retrieval-quality
testing, representative-document testing and evidence-driven critical fixes.
They require an approved non-production Supabase target and/or sanitized AIC
sample files. No RAG source was changed because that work is reserved.

## Phase 4 — Advanced intelligence

**Done:** all currently tracked code deliverables remain Built and unchanged by
this release.

**Not done:** provider privacy approval for real AIC content. Endpoint success
does not approve free-tier data handling.

## Phase 5 — Team communication

**Done:** the latest upstream branch work and the existing collaboration release are
reconciled on `Timi-Dev`: governed Teams and DMs, replies, mentions, reactions,
retention, document references, thread promotion, Realtime and in-app
notifications remain present.

**Not done:** live socket/browser verification. Migrations `0010`–`0016` must be
applied before deploying the matching source. Email digests remain an explicitly
deferred external-provider enhancement.

## Later agreed work — offline access and selected-passage comments

**Done:** migration `0017` defines owner-only offline vetoes, per-user/per-device
renewable 30-day leases, immutable client audit boundaries, revocation reasons
and batch revalidation. Application code adds permission-checked signed offline
grants, IndexedDB reading, expiry/reconnect/sign-out purge, a persistent staged
upload queue, idempotent upload finalization, an offline library, a PWA manifest
and a narrowly scoped service worker. PDF text selection now fills page and quote
into the existing comment workflow without touching RAG.

**Not done:** database execution and browser verification for `0017`. There is
no approved development database and the production project must not be mutated
without explicit approval. Queued comments/chat and “cache everything I own”
remain second-pass items; scanned-PDF passage selection waits for OCR.

## Phase 6 — Security, performance and production hardening

**Done:** 176 automated tests pass; 125 executable permission assertions exist;
TypeScript, ESLint and the Next.js production build pass. Migration `0017`
follows least privilege: authenticated sessions may select permitted audit rows
but cannot insert, update or delete them directly.

**Not done:** the 125-assertion PostgreSQL permission harness has not run through
`0017`, and no hosted destructive suite was run. Those are verification gaps,
not code-completion claims.

## Deployment order

1. Create or approve a safe Supabase target.
2. Apply migrations `0010` through `0017` in order.
3. Deploy the matching application commit.
4. Run hosted RLS and two-account browser workflows.
5. Only then promote the same migration/application pair to production.

Deploying the current application before its pending migrations would create
runtime failures in chat and offline routes. No hosted database migration or
production application deployment was performed in this work.
