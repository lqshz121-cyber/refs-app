# Refs Agent and Chatbox Dispatch — 2026-09-14

## Authoritative integration lane

- Repository: `https://github.com/lqshz121-cyber/refs-app.git`
- Integration checkout: this checkout only
- Branch / SHA: `codex/374-postgres-syntax-verify` / `762591e47a5fb7e07aaf51c12af0e2156ff98c20`
- PR: #582 (draft)
- Rule: no candidate is merged, deployed, or represented as production evidence until independently reviewed on the authoritative checkout and its applicable gates are green.

## Work ledger

| Lane | Owner/source | Current evidence | Decision and next action | Acceptance evidence |
|---|---|---|---|---|
| Kernel migration integrity | Codex | Local real PostgreSQL round-trip passed for the immutable migration barrier; PR #582 Accounting Kernel Gate currently running. | Hold source changes until all four PostgreSQL jobs terminal. If green, record exact run URL/SHA; if red, repair only the reported contract failure. | Green Accounting Kernel Gate, fresh DB migration and kernel checks with zero skips. |
| Outbox consumer | Codex CI | Run 34771337891 passed for PostgreSQL 15/16/18. | Treat as validated for this SHA; no duplicate work. | GitHub completed-success checks. |
| Immutable settlement migration review | Claude | `CLAUDE-TO-CODEX-2026-09-14-MIGRATION-305-STATIC-REVIEW.md` confirms applied migration bytes must remain unchanged and a forward migration plus manifest/down/test is required. | Use as design review only: Claude mount is stale and dirty. No patch may be lifted from it. Any future settlement correction is an additive migration on this checkout. | Review incorporated; additive migration fresh/upgraded/down retained-row tests pass. |
| Claude routing | Claude | Mount is at branch `claude/wbs-accounting-correctness-20260807`, SHA `98dcb137...`, with unusable shell/toolchain and many uncommitted historical files. | Route Claude only read/write document and static-review tasks. Give exact root-level task files and inline source excerpts when the task needs newer files. | A dated `CLAUDE-TO-CODEX-*` report that identifies evidence and limits. |
| Chatbox authoritative UI | Chatbox candidate checkout | Candidate branch `codex/qb-expenses-20260911`, base `1b4ce41e...`, four uncommitted files: `index.html`, `src/authoritative-topbar.jsx`, `tests/authoritative-full-shell.test.jsx`, `tests/navigation-a11y.test.js`. | After PR #582 CI finishes, inspect the exact diff, reapply only needed semantic/a11y improvements onto a clean authoritative branch, then run build and target tests. Do not merge the foreign worktree or copy broad UI changes. | Review notes, clean patch, build and named tests passing; visual/runtime evidence if changed UI is user-facing. |
| WBS / QBO evidence | User-authorized read-only systems | QBO/WBS are read-only; no live-write authority. | Maintain source evidence and immutable trace. Do not infer formal ledger entries from displayed reports. | Dated raw/normalized/staging trace with control totals and review approval. |
| Render | Existing paid services; no new spend | User has logged in; deployment and paid-resource changes remain outside current authorization. | Keep as a verification lane only after code gates are green. Prepare exact health/read-only acceptance plan before any action that changes services. | Read-only production identity/health evidence and release-SHA parity. |

## Dispatch protocol

1. Every task names the authoritative SHA, exact paths, expected deliverable, and allowed capabilities.
2. Claude reports are evidence only when they distinguish read observations from executed commands and list limits.
3. Chatbox work remains a candidate until re-reviewed from a clean checkout.
4. Integration changes are serialized while CI is active because a new push supersedes the running validation.
5. No agent may alter applied migration bytes, production accounting records, WBS, QBO, Render roles, or paid resources.

## Immediate sequence

1. Wait for run `34771337903` to reach a terminal state.
2. Close the migration integrity PR loop from its terminal GitHub evidence.
3. Review and selectively port the Chatbox UI candidate.
4. Continue the next accounting vertical from the requirement ledger, beginning with a verifiable WBS raw-to-draft trace and accounting controls, not a mock UI-only surface.

## Runtime observation (read-only, 2026-09-14)

Chatbox inspected QBO without any writes. Expenses was empty; reports and chart-of-accounts navigation were available; Bank Transactions showed `Unable to get transactions for 10 accounts`; Reconcile showed onboarding (`Connect now` / `Get started`). These observations are reference UX/data-availability evidence only. They do not prove a live accounting workflow and must not be used as a source of formal ledger entries or as release acceptance.
