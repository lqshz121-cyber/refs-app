# Unified project dispatch — 2026-09-14

## Authoritative line

- Integration checkout: `work/refs-accounting-settings-authoritative`
- Branch: `codex/374-postgres-syntax-verify`
- Current commit: `f0fcf5e4`
- External systems: QBO, WBS, and Render remain read-only. No deployment, paid-resource change, secrets, role changes, accounting posting, or push is included in this plan.

## Completed local-agent inputs

| Source | Status | Evidence / decision |
|---|---|---|
| Navigation usability | Complete | Commit `0143429d`: client blocks before OIDC/data reads when API and build SHA differ. Its exact commit must be independently integrated and revalidated before release use. |
| Attachment workflow | Complete | Render handoff metadata was corrected to distinguish functional SHA from handoff SHA. Recompute the handoff SHA at release review. |
| Settlement contract | Complete | P0 finding: applied migration 305 must never be edited in place. Any correction must be an append-only migration with manifest, downgrade safety, and fresh/upgrade test evidence. |
| Cash transfer | Integrated local closure | Commit `531d871b`, fresh PostgreSQL fixture 1/1, zero skips. Local evidence only. |
| AP reversal | Integrated local closure | Commit `4b96518f`, fresh PostgreSQL fixture 1/1, zero skips. Local evidence only. |
| AR credit allocation | Integrated local closure | Commit `9a29a0c3`, fresh PostgreSQL fixture 1/1, zero skips. Local evidence only. |

## Active work assignments

| Owner | Task file / lane | Allowed work | Deliverable | Acceptance |
|---|---|---|---|---|
| Claude static reviewer | `TASK-TO-CLAUDE-2026-09-14-APPLIED-MIGRATION-INTEGRITY-STATIC-REVIEW.md` | Read/reason/write only in its mounted checkout | `CLAUDE-TO-CODEX-2026-09-14-APPLIED-MIGRATION-INTEGRITY.md` | Explicit migration-305/411 findings and limits; no invented runtime evidence |
| Claude UI reviewer | `TASK-TO-CLAUDE-2026-09-13-AUTHORITATIVE-ENTRY-READONLY-REVIEW.md` | Read/reason/write only | `CLAUDE-REVIEW-2026-09-13-AUTHORITATIVE-ENTRY.md` | Route, callback, retry, token and UX review with exact paths |
| Claude release reviewer | `TASK-TO-CLAUDE-2026-09-13-RENDER-PRODUCTION-ACCEPTANCE.md` | Prepare only; no external mutations | Dated review report | Exact-SHA release/rollback plan and stated evidence gaps |
| Codex integration | Current authoritative checkout | Implement only verified additive repairs; run relevant local tests | Committed code plus command receipts | Clean tree, focused gates, no altered applied migrations |
| Chatbox candidate work | Candidate worktrees only | Supply a narrow diff or review notes | Candidate patch / notes | Re-review on authoritative checkout; no direct merge or deployment |
| User acceptance | Browser / Render / WBS / QBO | Read-only observation when a staged release exists | Observed behavior and screenshots/receipts as applicable | Exact release SHA plus authenticated read-only parity; local tests alone are insufficient |

## Sequencing

1. Resolve applied-migration integrity first; it is a release blocker.
2. Integrate or reject the independent UI gate after reviewing its precise diff on the authoritative checkout.
3. Run relevant local database, migration, API, and shell gates after each code change.
4. Only after a clean branch and independently reviewed release plan: prepare a read-only Render health/version inspection. Deployment is a separate action and remains unperformed.
5. WBS/QBO evidence remains reference-only until provider-signed source trace, human review, and authenticated readback exist.

## Routing rule

Tasks exist only when they are written at the root of the checkout mounted by their recipient. If a recipient cannot see a task, it must create an ACK showing its absolute path and capabilities; it must not infer work from a different worktree.
