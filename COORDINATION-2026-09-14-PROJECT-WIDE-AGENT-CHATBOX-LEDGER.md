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
| Chatbox/navigation candidate | Reviewed; no port required | Candidate `0143429d` has a 13-line release-mismatch block; identical functional behavior is already an ancestor of the integration line via `048c823e`, with current English copy and equivalent assertions | Reject as duplicate. `test:authoritative-release-gate`, `test:authoritative-full-shell`, and build passed on the integration checkout. |
| Other project worktrees | Inventory only | Many dated branches exist for assets, bank, reports, outbox, AI and UI | Do not bulk merge. Each requires an explicit problem statement, ancestry/diff review, and a focused acceptance gate. |

## Prioritized work queue

| Priority | Owner | Scope | Required deliverable | Gate / stop condition |
|---|---|---|---|---|
| P0 | Codex integration | Re-run WBS verifier suite after `96b4a480`; retain the two new controls and await real provider artifacts | Fresh command receipt | 17 named WBS tests passed with zero skips on the integration checkout. Never treat a synthetic manifest as provider acceptance. |
| P0 | Claude static reviewer | Future review only if the verifier or acceptance schema changes; current ordering and global-ID findings are implemented | Dated `CLAUDE-TO-CODEX-*` report with exact lines and limits | Read/reason/write only; no production claims. |
| P1 | Codex integration | Cash Transfer and durable outbox closures completed; next select the authoritative-entry Chatbox candidate review | Fresh PostgreSQL 16 receipts: Cash Transfer SoD/lifecycle `1/1`; outbox lease reclaim/retry/dead-letter/publish `1/1`. Focused outbox contracts `32/32`. | All named tests passed, zero skips; owned container, network, and volume were removed. Local evidence only. |
| P1 | Chatbox candidate reviewer | `0143429d` review completed; identify a new, non-duplicate candidate only when it has an explicit acceptance gap | Exact-file review note | No direct merge from a foreign worktree; authoritative build and relevant UI tests required. |
| P2 | Claude release reviewer | Prepare an exact-SHA Render read-only acceptance checklist: build/API version, health, callback behavior, and rollback evidence | Dated report; no external mutation | Release remains blocked until a deployed candidate SHA and authenticated read-only observations exist. |
| P2 | Codex release lane | Refresh local release-evidence bundle only after current local checks; leave its production fields unproven | Bundle manifest marked local/NOT_RUN where applicable | No push/deploy without separate authorization. |

## 2026-09-14 serial validation note

- A locally started aggregate server gate overlapped pre-existing PostgreSQL work and produced broad `55P03` lock timeouts. It was stopped and is not used as pass or failure evidence.
- Fresh isolated PostgreSQL 16 subsequently passed `signed-cost-cwip-post` 1/1, showing the Cost-to-CWIP closure itself was not the lock-timeout source.
- The aggregate output also exposed obsolete positive test principals that omitted the now-required server-side `tenantId`. The affected issuer fixtures were corrected and fresh isolated PostgreSQL 16 passed the exact entity/permission, revocation/expiry/self-issue, and read-grant fallback tests, each 1/1 with cleanup.

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

## 2026-09-14 integration update — `596f72b3450501242558990909181c5daf5b74d8`

- The authoritative integration tip is now `596f72b3450501242558990909181c5daf5b74d8` on `codex/374-postgres-syntax-verify`; it supersedes the `96b4a480` tip recorded in the original table.
- Commit `596f72b3` serializes `pgTest` database sections because the suite intentionally shares one migrated database, repairs syntax in the unshipped 407/408 rollback migrations, and updates only their manifest checksums. Applied migration 305 was not modified.
- Fresh PostgreSQL 16 passed `node runtime/test-postgres-fresh.mjs --pattern "concurrent up and down runners serialize on the same advisory lock"`: 1/1 pass, zero skip, owned container/network/volume removed. The test preserves the migration-305 immutable boundary and restores the full manifest after the competing down/up runs.
- Static 407/408 migration contracts passed 2/2. Fresh PostgreSQL 16 issuer-context tests passed 2/2, zero skip, with owned resources removed.
- This is local integration evidence only. Current-SHA remote CI, a staged Render SHA/read-only inspection, provider-signed WBS sample evidence, and all production acceptance receipts remain unresolved.

### Updated dispatch order

1. Do not dispatch a new Chatbox candidate or a broad test run while a fresh PostgreSQL gate is active.
2. Claude receives only root-level, dated, read/reason/write task files whose source SHA is `596f72b3450501242558990909181c5daf5b74d8` or newer; reports remain non-integration evidence until reviewed here.
3. Before any release review, regenerate the local evidence bundle from a clean checkout at the final candidate SHA. No push, deployment, financial posting, role change, or paid-resource change is authorized by this ledger.

## 2026-09-14 WBS local-control update — `06b0c9c0`

- The authoritative integration tip is `06b0c9c0` on `codex/374-postgres-syntax-verify`.
- Commit `06b0c9c0` validates the WBS twelve-sample `company_code` as a bounded canonical scope identifier before acceptance evidence is summarized. It prevents blank, mixed-format, and untrusted company scope values from entering the local verifier.
- Local verification passed: `node --test tests/wbs-twelve-sample-acceptance.test.mjs tests/wbs-live-acceptance.test.mjs` (17/17); `npm.cmd run test:wbs-live-pilot` (live-pilot 21/21, twelve-sample 3/3, controlled test-import/bank chain 26/26). These are local contract results only.
- The WBS twelve-sample production requirement remains open: it still requires twelve independently reviewable provider-signed packages, control totals, human review records, and authenticated same-release readback. No WBS write or provider assertion was made.

## 2026-09-14 bank-reconciliation local closure receipt — `396d6496`

- Local reconciliation contracts passed: `npm.cmd --prefix server run test:reconciliation` returned 4/4 pass.
- Fresh PostgreSQL 16 passed `node runtime/test-postgres-fresh.mjs --pattern "reconciliation lifecycle is scoped, idempotent, separated by role, snapshotted, and reopen-gated|reconciliation adjustment Draft binds one unresolved bank source through Posted clearance, review, and immutable sign-off|Stage 2 test-data chain traces one reconciled bank payment through its posted JE, GL, TB and report rows"`: 3/3 pass, zero skip, and the owned container/network/volume were removed.
- This covers local state, actor-bound idempotency, separated review/sign-off/reopen, immutable snapshot behavior, and Bank→Posted JE→GL/TB/report lineage. It does not prove a production bank statement, production reconciliation sign-off, deployed API SHA parity, or external provider evidence.

## 2026-09-14 Unit Transfer local closure receipt — `76c8dcb0`

- The current authoritative integration tip before this documentation receipt is `76c8dcb0fa9e054b2d161376e4ac35611d93ab7b`.
- `npm.cmd --prefix server run test:unit-transfer` passed 31/31: evidence-bound paired Drafts, three-revision CAS, dual-entity approval and post flow, controlled reversals, tenant/role isolation, private gates, audit/outbox, reciprocal intercompany open items, and rollback protections.
- `node runtime/run-postgres-fixture-suite.mjs --fixture unit-transfer-close` returned `REFS_POSTGRES_FIXTURE_SUITE_V1`, pass=true, 1/1, zero skip, using PostgreSQL 16 and removing its owned container/network/volume. It proves the controlled local chain from dual-entity Draft through separated approvals and atomic post to ownership transfer readback.
- This remains isolated local fixture evidence. Production source ownership, approved mappings, intercompany settlement, deployed API SHA parity, and authenticated production readback remain required for release acceptance.

## 2026-09-14 real-estate report local closures — `a3fd31fa`

- Fresh PostgreSQL 16 fixture-suite receipts all returned `REFS_POSTGRES_FIXTURE_SUITE_V1`, pass=true, 1/1, zero skip, with owned container/network/volume cleanup for each independent run:
  - `cash-flow-close`: POSTED cash only through one exact approved mapping snapshot.
  - `cwip-rollforward-close`: immutable CWIP mapping and posted-ledger evidence.
  - `construction-loan-rollforward-close`: credit-normal construction-loan mapping and posted-ledger evidence.
  - `prepaid-rollforward-close`: debit-normal asset mapping and posted-ledger evidence.
  - `intercompany-reconciliation-close`: two authorized entity scopes, reciprocal exact mappings and posted evidence without creating an elimination.
  - `consolidation-close`: approved immutable two-member scope, explicit elimination evidence, and no elimination journal creation.
- These prove controlled local report paths and guardrails only. They do not prove production mapping approvals, live source populations, deployed report data, or any production consolidation/close result.
