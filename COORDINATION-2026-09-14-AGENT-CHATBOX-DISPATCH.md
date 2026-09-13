# Refs Agent and Chatbox Dispatch — 2026-09-14

## Authoritative integration lane

- Repository: `https://github.com/lqshz121-cyber/refs-app.git`
- Integration checkout: this checkout only
- Branch / SHA: `codex/374-postgres-syntax-verify` / `8a425a3d3a5f449d0f676f774c7407e7ad3ee8d5` (local, not yet pushed)
- PR: #582 (draft)
- Rule: no candidate is merged, deployed, or represented as production evidence until independently reviewed on the authoritative checkout and its applicable gates are green.

## Work ledger

| Lane | Owner/source | Current evidence | Decision and next action | Acceptance evidence |
|---|---|---|---|---|
| Kernel migration integrity | Codex | Migration runner/safety and fixture-runner contracts pass locally. Commit `667fd428` corrects the 323 round-trip expectation without changing migration bytes. | Current SHA is not on GitHub, so fresh PostgreSQL 15/16/18 CI must be rerun after push; retain zero-skip requirement. | Green current-SHA Accounting Kernel Gate, fresh DB migration and kernel checks with zero skips. |
| Bank-match API receipt | Codex | `ed421282` allows the database-contractual nullable `source_document_id`; `1498bf35` adds null-versus-malformed regression coverage. API, Bank Match OpenAPI, reconciliation read and migration tests pass locally. | Push and obtain current-SHA CI; do not widen any other receipt field or source lineage rule. | Current-SHA API/contract CI and focused fresh PostgreSQL evidence. |
| Release evidence integrity | Codex | `8a425a3d` isolates bundle-test output. The current strict bundle records `clean=true`, `strict_clean=true`, but `head_ci.available=false` and local execution `NOT_RUN`. | Keep the bundle as local audit support only; refresh it after push and CI. | Exact SHA, clean tree, recorded local commands, CI check-runs, and required live/provider evidence. |
| Outbox consumer | Codex CI | Historical run `34771337891` passed for PostgreSQL 15/16/18 on an earlier SHA. | Do not use historical success as current-SHA evidence; rerun through CI after push. | GitHub completed-success checks for the current SHA. |
| Immutable settlement migration review | Claude | `CLAUDE-TO-CODEX-2026-09-14-MIGRATION-305-STATIC-REVIEW.md` confirms applied migration bytes must remain unchanged and a forward migration plus manifest/down/test is required. | Use as design review only: Claude mount is stale and dirty. No patch may be lifted from it. Any future settlement correction is an additive migration on this checkout. | Review incorporated; additive migration fresh/upgraded/down retained-row tests pass. |
| Claude routing | Claude | Mount is at branch `claude/wbs-accounting-correctness-20260807`, SHA `98dcb137...`, with unusable shell/toolchain and many uncommitted historical files. | Route Claude only read/write document and static-review tasks. Give exact root-level task files and inline source excerpts when the task needs newer files. | A dated `CLAUDE-TO-CODEX-*` report that identifies evidence and limits. |
| Chatbox authoritative UI | Chatbox candidate checkout | Candidate branch `codex/qb-expenses-20260911`, base `1b4ce41e...`, four uncommitted files: `index.html`, `src/authoritative-topbar.jsx`, `tests/authoritative-full-shell.test.jsx`, `tests/navigation-a11y.test.js`. | After PR #582 CI finishes, inspect the exact diff, reapply only needed semantic/a11y improvements onto a clean authoritative branch, then run build and target tests. Do not merge the foreign worktree or copy broad UI changes. | Review notes, clean patch, build and named tests passing; visual/runtime evidence if changed UI is user-facing. |
| WBS / QBO evidence | User-authorized read-only systems | QBO/WBS are read-only; no live-write authority. | Maintain source evidence and immutable trace. Do not infer formal ledger entries from displayed reports. | Dated raw/normalized/staging trace with control totals and review approval. |
| Render | Existing paid services; no new spend | User has logged in; deployment and paid-resource changes remain outside current authorization. | Keep as a verification lane only after code gates are green. Prepare exact health/read-only acceptance plan before any action that changes services. | Read-only production identity/health evidence and release-SHA parity. |

## Dispatch protocol

1. Every task names the authoritative SHA, exact paths, expected deliverable, and allowed capabilities.
2. Claude reports are evidence only when they distinguish read observations from executed commands and list limits.
3. Chatbox work remains a candidate until re-reviewed from a clean checkout.
4. Integration changes are serialized while CI is active because a new push supersedes the running validation. Until network recovery, preserve the local commit chain and do not claim current-SHA CI.
5. No agent may alter applied migration bytes, production accounting records, WBS, QBO, Render roles, or paid resources.

## Immediate sequence

1. Restore GitHub connectivity, push `8a425a3d`, and record the resulting current-SHA CI URLs and outcomes.
2. Re-run the fresh PostgreSQL 15/16/18 gates and preserve their zero-skip receipts.
3. Review and selectively port the Chatbox UI candidate only after its exact diff is independently validated on this checkout.
4. Continue the next accounting vertical from the requirement ledger, beginning with a verifiable WBS raw-to-draft trace and accounting controls, not a mock UI-only surface.

## Runtime observation (read-only, 2026-09-14)

Chatbox inspected QBO without any writes. Expenses was empty; reports and chart-of-accounts navigation were available; Bank Transactions showed `Unable to get transactions for 10 accounts`; Reconcile showed onboarding (`Connect now` / `Get started`). These observations are reference UX/data-availability evidence only. They do not prove a live accounting workflow and must not be used as a source of formal ledger entries or as release acceptance.
