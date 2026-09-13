# Project-wide agent and Chatbox dispatch ledger — 2026-09-14

## Authority and boundaries

- **Only integration checkout:** `work/refs-accounting-settings-authoritative`, branch `codex/374-postgres-syntax-verify`, current integration tip `96b4a480` at the time this ledger was written.
- A commit in another worktree is a **candidate**, never an implicit integration or release. It must have a narrow diff review, be ported or cherry-picked deliberately, and pass its applicable gates on the integration checkout.
- QBO, WBS, and Render are read-only reference/verification systems. No deployment, role change, paid-resource change, accounting write, provider write, or push is dispatched by this ledger.
- Local fixture/container results are local evidence only. Production acceptance additionally needs exact deployed SHA, authenticated read-only evidence, and the applicable external-provider receipts.

## Consolidated inputs

| Source | State | Verified output | Dispatch decision |
|---|---|---|---|
| Codex integration | Active | `531d871b` cash transfer repair; `4b96518f` AP reversal fixture; `9a29a0c3` AR allocation fixture; `940d94dc`/`96b4a480` WBS evidence hardening | Keep as the only code-integration line; run focused gates before selecting another vertical. |
| Claude migration review | Complete | Current 305/411 manifest checksums match files; 305 must remain immutable; 411 is append-only and its no-op down preserves retained evidence | Treat as a release constraint. Any further repair is a new migration with fresh/upgrade/down testing. |
| Claude WBS intake review | Complete and acted on | Found missing temporal and cross-category evidence checks plus length guard defect | `96b4a480` enforces review-at-or-before-post and globally unique cross-category business evidence IDs, including regression tests; it also fixes the length guard. No claim of 12-sample provider acceptance. |
| Claude settlement review | Complete | Applied migration 305 must not be changed; historic down is unsafe for retained rows | Do not edit 305. Require an additive migration and explicit upgrade/retained-row proof for any settlement change. |
| Claude attachment workflow | Complete | Render handoff metadata needs the exact release SHA refreshed at release review | Keep as release evidence task only, after a staged candidate exists. |
| Chatbox/navigation candidate | Candidate only | `0143429d` blocks OIDC/data reads when client build SHA and API release SHA differ; tests passed in its own worktree | Independently inspect the exact diff, port only if it fits current routing, then rerun shell/a11y/build gates on the integration checkout. |
| Other project worktrees | Inventory only | Many dated branches exist for assets, bank, reports, outbox, AI and UI | Do not bulk merge. Each requires an explicit problem statement, ancestry/diff review, and a focused acceptance gate. |

## Prioritized work queue

| Priority | Owner | Scope | Required deliverable | Gate / stop condition |
|---|---|---|---|---|
| P0 | Codex integration | Re-run WBS verifier suite after `96b4a480`; retain the two new controls and await real provider artifacts | Fresh command receipt | 17 named WBS tests passed with zero skips on the integration checkout. Never treat a synthetic manifest as provider acceptance. |
| P0 | Claude static reviewer | Future review only if the verifier or acceptance schema changes; current ordering and global-ID findings are implemented | Dated `CLAUDE-TO-CODEX-*` report with exact lines and limits | Read/reason/write only; no production claims. |
| P1 | Codex integration | Cash Transfer and durable outbox closures completed; next select the authoritative-entry Chatbox candidate review | Fresh PostgreSQL 16 receipts: Cash Transfer SoD/lifecycle `1/1`; outbox lease reclaim/retry/dead-letter/publish `1/1`. Focused outbox contracts `32/32`. | All named tests passed, zero skips; owned container, network, and volume were removed. Local evidence only. |
| P1 | Chatbox candidate reviewer | Inspect candidate `0143429d` against the current authoritative entry flow and report a narrow port recommendation | Exact-file review note or narrowly ported patch | No direct merge from a foreign worktree; authoritative build and relevant UI tests required. |
| P2 | Claude release reviewer | Prepare an exact-SHA Render read-only acceptance checklist: build/API version, health, callback behavior, and rollback evidence | Dated report; no external mutation | Release remains blocked until a deployed candidate SHA and authenticated read-only observations exist. |
| P2 | Codex release lane | Refresh local release-evidence bundle only after current local checks; leave its production fields unproven | Bundle manifest marked local/NOT_RUN where applicable | No push/deploy without separate authorization. |

## Coordination protocol

1. A task is routed only by a root-level `TASK-TO-CLAUDE-YYYY-MM-DD-*.md` file in the recipient's mounted checkout. The task states the authoritative path, source SHA, permitted operations, and output filename.
2. Every report starts with its mounted path, files inspected, commands and exit codes, and the boundary between static observation and executed evidence.
3. Codex records an accept/reject/needs-more-evidence decision here or in the linked task file before any candidate change enters the integration checkout.
4. Chatbox candidates remain separate until their commit is re-reviewed against the integration tip; copying unrelated files or broad worktree merges is prohibited.
5. When a new integration commit is made, rerun its relevant gates and regenerate the local evidence manifest. A stale SHA invalidates prior release evidence for that commit.

## Explicitly unresolved release evidence

- Current-SHA remote CI and GitHub check runs.
- Deployed Render build/API SHA parity, health, callback, and authenticated browser behavior.
- Provider-signed WBS twelve-sample package, control totals, independent human review records, and authenticated online readback.
- Production object-store/scanner/IAM lifecycle and retained backup/restore evidence.

These are release acceptance requirements, not completed evidence.
