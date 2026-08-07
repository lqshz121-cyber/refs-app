# Claude Round 20 — Exact Work Division

Base: `origin/main` at `036acb4`, unless Codex publishes a newer frozen SHA. Do not use the shared dirty worktree as a base.

## Rule

Codex is the only pusher to `main`. Claude sessions may develop broadly, but each must claim one lane and use one isolated branch.

| Lane | Owner | Outcome | Owns | Must not duplicate |
| --- | --- | --- | --- | --- |
| A visual UI proof | Claude UI | Measured responsive/accessibility evidence and defect-backed repair | `index.html`, `src/ui.jsx`, visual verifiers, breakpoint docs | token consolidation, OS theme preference, drawer inertness, server/API/migrations/WBS |
| B close accounting | Claude Accounting | Source-backed balanced Draft generators | new close modules/tests and narrow close integration | COGS, IC elimination, opening balances, period master, JE state machine, auto-post |
| C Bank/Reconcile PG | Claude Kernel | PG15/16 proof of concurrency, idempotency, revision, rollback and ambiguity zero-write | server command/migration/tests/OpenAPI if an existing command needs it | UI, WBS transport, AP/AR allocation semantics |
| D WBS contract/pilot | Claude WBS | Provider-field matrix and deterministic redacted contract tests | WBS catalog/contract docs/tests, not pull tool | WBS UI/write, live call, credentials, raw data, Draft/Approve/Post |
| E release | Codex | clean integration, deployment, main push and live evidence | release/deploy/cross-lane conflicts | direct third-party release claims |

## Ordered work

### 006 — Lane A, start now

Prove Dashboard, BankTx, Reconcile, Expenses, Accounting, Reports, AI Audit and JE at 1440, 1280, 1024, 768, 430 and 360. Assert innerWidth, overflow, off-screen focus, console, visible English text and dark contrast. Submit screenshots and only observed defect fixes.

### 007 — Lane B, start now

Build one reusable source-backed fixed-point Draft generator framework. Cover retainage, prepaid amortisation, insurance/property-tax accrual and depreciation. Every proposal includes entity, period, source, mapping, idempotency, balanced lines and audit reason. Missing facts create Review exceptions; none may be inferred. Standard Review -> Approve -> Post remains unchanged.

### 008 — Lane C, start now

Harden existing Bank Match/Reconcile commands with real PG15/16 evidence: exact POSTED linkage, replay, active-match reversal block, duplicate-cash ambiguity zero-write, lock ordering and rollback. Each new migration needs up/down/checksum/fresh-DB proof.

### 009 — Lane D, after Codex publishes WBS pull hardening

Compare the v0.1 provider contract with all eight REFS source schemas. Mark every field provider confirmed, REFS-declared, unknown, or fail-closed. The first live operator action is `get_meta`, then one `list_payables --limit 1` with session-only rotated credentials. Claude does not perform that live operation.

## Cross-lane prerequisites

1. Public GitHub Pages intentionally runs `LOCAL_MOCK`; it cannot prove API/PG/OIDC authority.
2. `integration/wbs-pilot-hardening-036acb4` at `3a13874` owns the WBS pull fixes. Lane D must not touch its two pull files until that branch lands.
3. An exit-zero PostgreSQL test with skipped cases is not a pass.
4. WBS is inbound, read-only and evidence-gated. It never creates, approves, dispatches or posts a journal itself.
5. No direct main push and no production-equivalence claim from fixtures, Pages, static analysis or local simulation.

## Completion record

```text
SHA/base:
lane and branch:
changed files:
tests + exact exit codes:
PG15/PG16 executed/pass/skip counts (if server):
browser evidence path and dimensions (if UI):
exclusions and risks:
PASS / PARTIAL / FAIL:
next:
```
