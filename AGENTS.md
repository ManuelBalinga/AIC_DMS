<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project conventions

## Keep PROJECT_STATUS.html current

`PROJECT_STATUS.html` is the shared status document — the one Manuel and whoever
is building both read. It is not a report written at the end; it is expected to
be accurate at every commit.

Whenever deliverable status changes, update it in the same commit as the work:

- A deliverable that becomes code-complete moves to **Built**. "Built" means
  code-complete, type-checked, linting and building clean. It does **not** mean
  verified against a live database — say so rather than implying otherwise.
- New deliverables get added as new rows, under a group heading naming where
  they came from (a plan section, or the conversation that prompted them).
- The counts in **Overall progress** and the progress bar are updated to match.
  They are derived from the rows, so they drift silently if only rows change.

The authoritative scope is
`Documentation/AIC_Intelligent_Knowledge_Management_System_Revised_Project_Plan.docx`
(§10 for the three-week deliverables, §11 for acceptance criteria). When the
status page and the plan disagree, the plan wins — and the page gets corrected.

## Branch

Work from Claude Code on the web goes to `Claude-Dev`.
