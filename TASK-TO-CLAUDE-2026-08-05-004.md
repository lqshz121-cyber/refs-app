# Claude Task: Final full-site UI system pass on the released integration

**Priority:** P0
**Category:** Frontend / UI design
**Base:** `122f475375f587fd1845c3b111d2d856c8188cc5`
**Branch:** `claude/final-ui-system-pass-122f475`
**Live reference:** `https://lqshz121-cyber.github.io/refs-app/?release=122f475`

## Current verified baseline

- The live build is English-only and has no detected CJK or mojibake.
- Dashboard, Reports, Bank Transactions, Reconciliation, Expenses, Accounting,
  Rule Center, Integration Hub, AI Audit, and Journal Entry are the required
  customer-facing workspaces.
- Sidebar groups expand independently; selecting a child must not collapse any
  other expanded group.
- The Reports control area was changed to a responsive grid. It has no page-level
  horizontal overflow at 1440px, 768px, or 360px.
- The legacy local cash report now says `Cash movement evidence` and explicitly
  states that it is not a complete statement of cash flows.

Do not revert or weaken any of these verified behaviors.

## Assignment

Perform a coherent visual-system pass on the released baseline. Review every
required workspace as one product rather than applying isolated page patches.
Use the live site and the source together.

Focus on:

1. consistent page hierarchy, title/subtitle rhythm, cards, filters, tabs, tables,
   status badges, action placement, empty/loading/error states, and full-page Back;
2. QuickBooks-quality information density with calmer Apple-like spacing,
   typography, borders, focus treatment, and responsive behavior;
3. table readability at 1440px and 1280px, including stable headers, numeric
   alignment, meaningful column widths, truncation with accessible full text,
   and table-local scrolling where necessary;
4. mobile/tablet behavior at 1024px, 768px, 430px, and 360px: no body overflow,
   overlap, clipping, concatenated labels, unreachable buttons, or hidden status;
5. consistent disabled/read-only treatment so unavailable QBO reference actions
   do not look executable;
6. English-only visible copy, accessible labels, keyboard focus, ARIA state, color
   contrast, and dark-mode parity;
7. removal or consolidation of duplicate CSS rules that currently fight across
   breakpoints. Prefer shared tokens/components over page-specific overrides.

## Accounting and integration boundaries

- Do not change accounting calculations, source classifications, state machines,
  API/OpenAPI contracts, migrations, WBS/MCP logic, or authorization behavior.
- WBS is an upstream read-only accounting-data source. Do not create WBS business
  pages, write to WBS, or expose WBS credentials/provider rows.
- Do not add export, payment rails, bank feeds, connect/import/OCR, auto-match,
  auto-categorize, auto-post, sign-off, destructive actions, or promotions.
- Preserve Draft -> Review -> Approve -> Post, segregation of duties, immutable
  Posted evidence, and reversal-only correction.
- Details replace the workspace and Back restores entity, dates, dimensions,
  filters, query, selection, pagination, and scroll context.
- Do not change truthful evidence labels into parity or production claims.

## Required evidence

Capture page-specific screenshots and visible-text extracts for all ten named
workspaces at 1440x1000 and 1280x720, plus representative 768x900 and 360x800
captures. Record page-level horizontal overflow checks and browser console errors.

The completion handoff must include:

- SHA/base and isolated branch;
- exact changed files;
- before/after evidence paths;
- design decisions and shared tokens/components changed;
- `npm.cmd test`, `npm.cmd run test:visual`, `npm.cmd run build`,
  `node verify-global-visible-english.mjs`, and `git diff --check`, all with exit 0;
- remaining risks and an explicit `no release / no accounting behavior change`
  statement.

Do not merge or push to `main`. Codex remains the integration and release owner.
