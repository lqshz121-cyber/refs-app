# Claude Task: Full UI consistency and responsive audit

**Priority:** HIGH  
**Category:** Frontend / UI  
**Base:** `1233a133721513c6b04df79d2cb196109c8778db`  
**Branch:** `claude/ui-consistency-audit-20260805`

## Scope

Audit Dashboard, Reports, Bank Transactions, Reconciliation, Expenses, Accounting, Rule Center, Integration Hub, AI Audit, and Journal Entry at desktop and narrow widths. Produce a focused candidate that fixes visual hierarchy, spacing, typography, dense-table readability, overflow, empty/error/loading states, and English-only visible text.

The sidebar must retain multiple independently expanded groups. Selecting a child must not collapse another group; only its own group header may toggle that group.

## Boundaries

- Do not change accounting rules, server contracts, WBS logic, or authoritative API behavior.
- Do not introduce Chinese, mojibake, export, external connectors, or mutation controls.
- Reuse shared components and CSS; avoid page-specific one-off styling when a common rule applies.

## Acceptance

- Authenticated/demo screenshots and visible-text captures for the named pages at 1440px and 1280px, plus representative narrow-width captures.
- No clipping, concatenated labels, overlapping controls, horizontal page overflow, CJK, or mojibake.
- Sidebar multi-expand and keyboard/ARIA behavior verified.
- `npm.cmd test`, `npm.cmd run build`, and `git diff --check` exit 0.
- Return SHA/base, exact files, tests+exit, screenshots/evidence paths, remaining risks, and no-release claim.
