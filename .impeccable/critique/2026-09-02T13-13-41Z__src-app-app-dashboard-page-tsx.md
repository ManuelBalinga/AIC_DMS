---
target: AIC Documents dashboard (src/app/(app)/dashboard, src/app/(app)/layout.tsx)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\user\\OneDrive\\Documents\\AIC\\AIC_DMS\\src\\app\\(app)\\dashboard\\page.tsx"
target_fingerprint: "sha256:a8b3ea27e23c4835c70427d64a3d5527185a0ac38d211efe86c6d93c4fa44e10"
target_path: "C:\\Users\\user\\OneDrive\\Documents\\AIC\\AIC_DMS\\src\\app\\(app)\\dashboard\\page.tsx"
timestamp: 2026-09-02T13-13-41Z
slug: src-app-app-dashboard-page-tsx
---
Method: dual-agent (A: a55b467841ba66f7c · B: ab5c0d43356568a0d)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strong upload-status granularity and a real loading skeleton, but primary nav has no active/current-page state |
| 2 | Match System / Real World | 3 | Plain, consistent copy; the "AI" document badge is unexplained jargon with no tooltip |
| 3 | User Control and Freedom | 2 | Cancel is fully disabled for the entire duration of a submitted upload batch — no backing out mid-batch |
| 4 | Consistency and Standards | 3 | Disciplined token reuse (Card/Badge/Button/Alert), undercut by focus-ring styling that exists only on `<Button>`, not `<Link>` |
| 5 | Error Prevention | 2 | Upload-size validation is solid; Sign Out silently wipes local offline data and queued uploads with zero warning |
| 6 | Recognition Rather Than Recall | 3 | No icon-only nav anywhere (genuinely good); "AI" badge again relies on prior knowledge |
| 7 | Flexibility and Efficiency | 2 | Real accelerators exist (URL-persisted filters, drag-anywhere batch upload) but zero keyboard shortcuts and no bulk actions on existing documents |
| 8 | Aesthetic and Minimalist Design | 3 | Nothing extraneous on screen, but "purposeful use of color" is mostly unclaimed default Tailwind, not an authored choice |
| 9 | Error Recovery | 3 | Upload errors are specific and preserve work ("saved on this device, will retry automatically") |
| 10 | Help and Documentation | 0 | No help affordance anywhere — no tooltip, no docs link, no onboarding — in a tool with no separate support role |
| **Total** | | **24/40** | **Acceptable** |

Scored for real throughout — nothing marked n/a; this is an Operate-mode internal tool, so heuristics 7 and 10 apply in full. 24/40 (60%) is a real, working product with genuinely good error-handling bones and a near-total absence of authored visual identity, help, and power-user accommodation.

## Design Specificity Verdict

**Category-interchangeable, and it's verifiable at the file level, not just a vibe.** `src/app/globals.css` and `src/app/layout.tsx` are still unmodified `create-next-app` output — Geist fonts straight from `next/font/google`, generic `--background`/`--foreground` tokens, no AIC-specific type scale or palette anywhere. The one real piece of brand thinking that exists — `public/icon.svg`, a genuinely decent blue rounded-square document glyph — never appears inside the product itself; it's wired only into the PWA manifest and the browser-tab favicon. Strip "AIC Documents" out of the string literals and swap in any other internal CRUD tool's name — nothing else would need to change: not a color, not a spacing choice, not a component.

**The detector independently confirms the same root cause, on an adjacent page.** The dashboard itself came back clean under both methods — 0 CLI findings on its 4 scanned files, and the live browser overlay reported "No anti-patterns found" on `/dashboard`. But Assessment B verified this "clean" result is a tooling blind spot rather than a genuinely finished surface: the CLI's regex engine can only match a literal `font-family:` CSS string or a `nested-cards`-style DOM parent/child relationship, neither of which a Tailwind + `next/font` codebase ever produces in source text — so those checks structurally cannot fire against this codebase's `.tsx` files, confirmed by re-running the scanner directly against the two files that *did* show live issues and getting `[]` both times. One click deeper, on the document detail page, the **live DOM overlay did fire**: `overused-font` (Geist at 100% of text — the identical unmodified-scaffold finding Assessment A reached independently from reading source) and one modest `nested-cards` instance in the comment panel's permission notice. Two unrelated methods — pure code reading and live DOM scanning — converged on the same diagnosis from different pages and different evidence types: the scaffold was never revisited.

**Visual overlay status**: the browser-visible `[Human]` overlay ran and was stopped cleanly afterward per protocol; it is no longer live in any open tab.

## Overall Impression

The gut read: this is a backend-first build where the engineering is more considered than anything a user actually sees. The upload queue's partial-failure handling, the offline lease model, and the retrieval-safe permission boundary all show real design thinking — just none of it visual. Meanwhile the screen itself is still wearing `create-next-app`'s default clothes: unmodified Geist type, generic gray-on-white tokens, a brand mark that exists in the codebase but never made it onto the page. The single biggest opportunity is exactly the gap between those two halves — the product already knows what AIC needs it to *do*; nobody has yet decided what it should *look like* as AIC's.

## What's Working

1. **The upload queue's failure handling** (`upload-document.tsx`) — independent per-file status, partial-failure isolation ("a 40 MB scan timing out must not take nine successful uploads with it," per the code's own comment), and specific recovery copy. A rare case of an internal tool actually designing for its stated failure mode rather than assuming a happy path.
2. **"Also mentioned inside"** (`page.tsx`) — surfacing documents that match on indexed content rather than title/tags, correctly de-duped against the primary list, with a plain-language explanation of why they're there. A genuinely thoughtful IA decision most internal tools wouldn't bother building.
3. **First-run and dropzone copy** — specific and on-voice ("move it off WhatsApp and into the platform," "Several at a time is fine") rather than placeholder-grade text.

## Priority Issues

**[P1] Sign Out silently destroys local offline data and queued uploads**
- **What**: `sign-out-button.tsx` calls `clearOfflineData()` unconditionally before `signOut()` — no confirmation, no warning copy, no check for whether there's anything to lose.
- **Why it matters**: This directly undercuts the product's own core promise — replacing a WhatsApp group where "you cannot tell who has it, you cannot take it back" with something more trustworthy. A field worker who leased documents for tomorrow's site visit, or has files still queued from a bad-connection session, loses them on one routine click, with zero advance notice.
- **Fix**: Confirm only when there's something at stake — "Signing out will remove N offline document(s) and any files not yet uploaded from this device. Continue?" — skip the interruption otherwise.
- **Suggested command**: `/impeccable harden`

**[P1] No authored visual identity — the app is still running scaffold defaults**
- **What**: `globals.css`, the fonts, and the color tokens are unmodified `create-next-app` output; the one real brand asset (`public/icon.svg`) never appears inside the product itself.
- **Why it matters**: This is a credibility problem, not just a cosmetic one — after replacing WhatsApp, AIC staff have no visual cue that this is *their* considered, trustworthy home for documents rather than an unfinished scaffold.
- **Detector confirmation**: independently verified live — `overused-font` fired on the document detail page at 100% text coverage, the same Geist-default finding, reached by a completely different method.
- **Fix**: Pull the existing icon mark into the header next to the wordmark; convert the raw CSS variables into named, chosen brand tokens.
- **Suggested command**: `/impeccable polish`

**[P1] Zero in-app help in a tool with no support role to fall back on**
- **What**: Heuristic 10 scored 0/4 — no tooltip, docs link, onboarding, or contextual hint anywhere in scope. The "AI" badge and "indexed" concept are never explained.
- **Why it matters**: There is no separate IT/support role — the one administrator manages access *and* uses the product day to day. A confused new hire has nobody to ask and nothing in the UI to consult.
- **Fix**: Start minimal — a `title` attribute on the "AI" badge explaining what it means, one contextual line near Upload for first-time users.
- **Suggested command**: `/impeccable onboard`

**[P2] No active-page indicator in primary navigation**
- **What**: The nav link style in `layout.tsx` is one static class applied identically regardless of route — no active-route check, no `aria-current`.
- **Why it matters**: Inconsistent with the scope/tag filter pills on the same page, which *do* compute and style an active state — the same kind of "current selection" is handled two different ways in adjacent UI.
- **Fix**: Compute the active route, apply a distinct style plus `aria-current="page"`.
- **Suggested command**: `/impeccable clarify`

**[P2] Focus-visible styling exists only on `<Button>`**
- **What**: Every plain `<Link>` — nav items, document rows, filter pills, tag pills — carries no custom focus-visible class; only the browser default applies.
- **Why it matters**: A keyboard user's entire sense of "where am I" depends on this ring, and right now it works only incidentally, not by design.
- **Fix**: Extend the existing focus-visible treatment already defined on `Button` to the Link-based interactive elements.
- **Suggested command**: `/impeccable harden`

## Persona Red Flags

**Alex (Power User)**
- Zero keyboard shortcuts anywhere — no way to jump to search or open the upload dialog without the mouse.
- No bulk actions on *existing* documents — multi-select only exists for new uploads, not for managing what's already on the platform.
- No sort control on the document list.
- Cancel is disabled for the entire duration of a submitted batch — once Alex hits Upload on 8 files, there's no backing out even if file #2 was wrong.
- Counterpoint worth naming: drag-anywhere batch upload with one shared description/tags field *is* a real accelerator — the gap is that it's batch-friendly only on the way in, rigid everywhere else.

**Sam (Accessibility-Dependent User)**
- The search input has an `aria-label` but no visible `<label>` — fine for a screen reader, but a low-vision user relying on zoom sees only placeholder text that vanishes on typing.
- No skip-to-content link — every page load requires tabbing through the full header before reaching page content.
- Focus rings undefined on every `Link`-based element (see P2 above).
- The "AI" badge and comment-count badge communicate meaning through color plus a bare abbreviation/number, no text alternative.
- No `aria-current="page"` anywhere — Sam's screen reader never announces which nav section is active.

**Efua (Field Officer, Intermittent Connectivity)** — project-specific, derived from PRODUCT.md's Operating Context ("Members genuinely lose connectivity at times... this is why offline access was built as a first-class feature")
- The document list shows Owner/Shared/AI/comment-count badges per row but **no "available offline" indicator** — Efua can't tell from the dashboard which documents she's already leased for offline reading without knowing the separate `/offline` route exists.
- The offline-status signal is a fixed bottom banner that only appears *after* the connection actually drops — nothing on the dashboard prepares her beforehand.
- The dashboard is a server-rendered page that queries Supabase on every load; with the service worker failing to register (confirmed live this session), a cold load while offline has nothing cached to fall back to.

## Minor Observations

- `nested-cards` (detector-confirmed, document detail page): a background-less info notice nested inside a `Card` in `comment-panel.tsx` — modest, not a heavy duplicated card, but a real instance one click from the dashboard.
- Two nav items resolve to the identical URL — the "AIC Documents" wordmark and the "Documents" link both point to `/dashboard`.
- Estimated (not live-measured — the dev server dropped before contrast sampling could run) from Tailwind's documented default palette: `text-neutral-400` on white computes to roughly 2.3:1, well under WCAG AA's 4.5:1, used for every document's date stamp; `text-neutral-500` sits near the ~4.6:1 edge and carries most secondary text.
- The filtered-empty-results message never mentions the Mine/Shared scope filter as a possible cause of zero results, even though it's one of three active filters.
- `Alert`'s `role="status"` (polite) is used for all three tones including "error" — a genuine error arguably wants `role="alert"` (assertive), which matters most exactly when an upload fails.
- Badge ordering on a document row has no evident priority logic; as more badge types get added this row will crowd fast.
- The dev-mode service-worker registration error is real (unhandled rejection, no `.catch` on `navigator.serviceWorker.register`) but understood as a dev-only artifact, not a design issue — cheap to silence properly regardless.

## Questions to Consider

1. AIC Documents is explicitly positioned as the trustworthy alternative to a WhatsApp group that loses documents — so why does signing out silently delete local offline copies and unsent uploads with the exact same one click as signing out of a device with nothing to lose?
2. The platform ships a real brand mark that no one using the product will ever see, because the header only shows a text wordmark. If AIC staff can't recognize this as *theirs* at a glance, what is the icon for?
3. Every heuristic verifiable here is either solid engineering (offline retry, per-file upload status, partial-failure handling) or completely absent (help, shortcuts, active-nav state) — almost no in-between. What would it take to make the undecided half as deliberate as the built half clearly already is?
