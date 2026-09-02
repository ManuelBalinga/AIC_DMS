---
version: 1
slug: "src-app-app-dashboard-page-tsx"
primary_target: "src/app/(app)/dashboard/page.tsx"
related_targets: ["src/app/(app)/layout.tsx"]
---

## Scope

Mode: Operate. Primary surface: the authenticated dashboard (`src/app/(app)/dashboard/page.tsx`), including the shared shell (`src/app/(app)/layout.tsx`) that wraps every signed-in page. Established here, this world extends across the rest of the product on later passes.

Audience: AIC staff (administrator + members) checking, uploading, and finding documents day to day, some on a poor connection in the field. Task: scan the list, find or search an entry, open it, act (share/comment/retract), trust that the record is honest. Constraints: plain, direct voice already set by existing copy; no separate support role, so the surface must be self-explanatory.

## Direction contract

THESIS: A document is a permanent, dated ledger entry — never a card in a generic dashboard grid. Refuses the soft-rounded-card SaaS default that makes this look like any internal tool.

OWN-WORLD: Deep ledger-cloth ground (ink navy or forest), ruled cream/ivory content field, red rule lines marking structure, brass-gold reserved for headers and active state. Numbered folio entries, tabbed dividers standing in for filters, a running entry count. Status marked by dated inline annotation, never color alone.

STORY: This is where AIC's record lives, and it can be trusted — nothing here quietly vanishes, every change is dated and visible, and I can always find what I'm looking for.

FIRST VIEWPORT: An open ledger page. Folio-numbered document rows fill the field; top-edge tabs stand in for All/Mine/Shared; search sits as a ruled entry line; "Open a new entry" (Upload) is the primary action, top-right, weighted like a real stamp rather than a flat button.

FORM: The Registrar's Ledger — assigned index 4 of 7 grounded, AIC-audience candidates by an external dice roll, seed key 6fc42c31. Raise donated from the declined Cassette-Futurism Tape Deck challenger: permission changes (share/revoke) get a deliberate, weighted "stamp" commit motion, not a flat instant toggle.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved decisions

- Exact palette values (which ink/cloth color, exact red/brass tones) — chosen during build, within the OWN-WORLD block's constraints.
- Typeface: a workhorse system/UI face per Operate-mode guidance, not a display serif; exact face chosen during build.
- Whether the ledger metaphor extends to Messages and Offline on this same pass or a later one (PRODUCT.md and the critique both flag Messages retention as conceptually identical — "struck through and dated, never removed" — a strong natural fit, deferred to avoid over-scoping this first pass).
