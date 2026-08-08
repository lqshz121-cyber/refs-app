# WBS Finance-to-REFS inbound handoff

## Status

This handoff describes a **local, test-verified inbound boundary**. It is not
production acceptance, a live WBS import, or authority to post a journal.

- Worktree: `C:\Users\lqshz\Documents\Codex\2026-08-01\re\work\refs-wbs-final-inbound`
- Integration base: `9c2b5a3` (`origin/main` at worktree creation)
- Frozen code candidate HEAD: `8d934dfa628129ff8db1edd89c7a47cbc8f06069`
  (parent `dcdb97bf10224f73b2d18a86d1b3473af7fa50a8`; clean worktree verified).
- Candidate commits: recorded in the integration order below.
- Live WBS signed, nonempty receipt: **UNKNOWN**.

## Delivered inbound capabilities

| Area | Delivered behavior | Key files |
| --- | --- | --- |
| Formal MCP lineage | Classifies Payable, Bank Transaction, and AutoRec Detail as possible transaction input; classifies AutoRec Bank, Journal Entry, Cost GL, Property Comparison, and trace as control/trace evidence. | `server/runtime/wbs-mcp-inbound-lineage.mjs`, `server/WBS-MCP-INBOUND-LINEAGE.md` |
| Snapshot safety | Requires one company, one capture timestamp, stable ascending keys, canonical hashes, and no duplicate producer views. Missing keys in a later snapshot are `ABSENT_UNCONFIRMED`, never deletions. | `server/runtime/wbs-mcp-inbound-lineage.mjs` |
| Receipt-to-staging bridge | Converts eligible formal MCP envelopes to the existing receipt-backed WBS Raw -> Normalized -> Staging ingress shape; preserves per-envelope and per-row hash provenance. | `server/runtime/wbs-mcp-inbound-lineage.mjs`, `server/runtime/wbs-inbound-data-adapter.mjs` |
| Inbound orchestration | Pulls only Payable, Bank Transaction, and AutoRec Detail through an injected read-only client; validates company and snapshot consistency. | `server/runtime/wbs-mcp-inbound-service.mjs` |
| Control and trace reads | Separately pulls only AutoRec Bank, WBS Journal Entry, Cost GL total, or trace relation evidence; none may enter transaction persistence. | `server/runtime/wbs-mcp-inbound-service.mjs` |
| Signed pipeline | Pull -> independent detached-signature verification -> admission -> existing receipt-backed persistence. Signature/admission failure occurs before persistence. | `server/runtime/wbs-mcp-inbound-pipeline.mjs` |
| AutoRec proposal | Produces read-only, review-required match proposals and totals; does not reserve, allocate, release, incur, create Draft JEs, or post. | `server/runtime/wbs-inbound-data-adapter.mjs` |
| Report controls | Cost GL and Property Comparison reconcile only with immutable receipts and exact approved mappings. They cannot become source documents or journals. | `server/runtime/wbs-control-reconciliation.mjs` |
| Golden coverage | Provides 12 sanitized/local matching scenarios and control/trace assertions. | `server/tests/wbs-autorec-golden-scenarios.test.mjs` |

## Verified test evidence

Run from `C:\Users\lqshz\Documents\Codex\2026-08-01\re\work\refs-wbs-final-inbound\server`:

```powershell
node --test tests/wbs-mcp-inbound-pipeline.test.mjs tests/wbs-mcp-inbound-service.test.mjs tests/wbs-inbound-data-adapter.test.mjs tests/wbs-mcp-inbound-lineage.test.mjs
npm.cmd test
git -C .. diff --check
```

At frozen code candidate `8d934df`, `npm.cmd test` exited `0`: `235/235` passing,
`0` skipped. Earlier focused evidence is retained in commit history; rerun the
focused command above after integration. `git diff --check` must exit `0` on
the target branch. These are local tests with injected provider/kernel seams,
not a production gate.

## Non-negotiable boundaries

1. WBS is read-only: no WBS mutation, including Add, Refresh, Delete, Release,
   Incur, Post, Cancel, Upload, Split, or mapping actions.
2. A read result without immutable signed receipt, scoped identity, date,
   amount, currency, direction, and required coding/mapping is an Exception,
   not a candidate.
3. Cost GL and Property Comparison are control evidence only; neither may
   create a source document, allocation, Draft JE, ledger line, or post.
4. AutoRec evidence may only form a REFS review proposal. Authoritative
   reservation/release/incur/JE creation/review/approval/posting stay in the
   REFS kernel and require its permissions, SoD, audit, and ledger controls.
5. Never store or log WBS credentials, URL tokens, cookies, or real business
   rows in source, tests, docs, or telemetry.

## Remaining P0/P1 and external requirements

### P0 — production admission evidence absent

- A real, nonempty WBS provider response with immutable source keys, delivery
  completeness, receipt reference/version, canonical payload hash, detached
  signature, key id, algorithm, public key/certificate, timestamp/nonce, and
  replay rules has not been verified.
- Provider meaning for lender/debtor and deposit/payment directions, revision/
  CDC/tombstone behavior, the AutoRec `pd_guid` to payment/bank relationship,
  and exact Cost GL/Property metric definitions remain unverified.
- Therefore no live WBS response may enter persistence, AutoRec, or a journal
  workflow until the signature verifier and receipt store are configured and
  independently tested with the provider material.

### P1 — integration work owned outside this boundary

- Kernel persistence must supply its existing `recordWbsSnapshot` and
  `persistWbsInboundRows` capabilities, preserving receipt/raw/normalized/
  staging trace and idempotency.
- The authoritative REFS AutoRec/JE workflow must consume reviewed rows only;
  it must enforce source-level reservation, accounting controls, SoD, and
  immutable ledger trace. This inbound work does not implement those commands.
- End-to-end production-like tests are still required: signature receipt ->
  PG persistence -> authoritative review state -> browser refresh. The local
  focused tests use injected doubles; no live WBS call occurred.

## Integration order

Apply or cherry-pick onto the target integration branch in this order:

1. `6843dce843ebf17642a14154e2f3c290ae9610a0` — formal MCP lineage map.
2. `715fd9800500a7fe49dda1d8a49a6c2e02377e8f` — receipt/staging bridge.
3. `8dfce30add0484c884c7a9195b7196232e142edf` — read-only golden proposals.
4. `191e8d4d840e6e17f45ee96e759bd9a73419f8ae` — report control gate.
5. `af890daafd34c2d255fa35832a9c1665daccc432` — read-only pull service.
6. `ae5cb9773e4f20477e6c1c7795b08041ae6e6537` — signature-to-staging pipeline.
7. `664f259986d8be426e8aad9187442bb181d9e2c6` — initial handoff document.
8. `d94a2282546ad3a703af5b29d46872575940a149` — duplicate/version source block.
9. `ccceba2cc93328149c31a6b104f7163df3b8dd2e` — observed WBS state evidence.
10. `d465b51cdadb41f53cb68a7baa27af83401dddd5` — transaction field/scope gate.
11. `99ceefa524055f97dd764b9dfa956926eea8bed0` — AutoRec Bank control evidence.
12. `83ac92b95d7929d51a1cbd5591b3ab57a862f81d` — WBS Journal Entry trace evidence.
13. `6948b801b24537ed81c811e59d47a7ac1ecd760c` — validated scope currency.
14. `cf353cbc76f951a22016b92be8bbeb495893de03` — separate control/trace reads.

15. `305675a875bde971e4b9defc72182f9e3f13990c` -- handoff sequence update.
16. `420264a1c040cd6ec26f47d1b4ed3af3d20fa3de` -- source versions are a
    canonical row hash, not the changing batch-envelope hash.

17. `8d934dfa628129ff8db1edd89c7a47cbc8f06069` -- receipt-to-control binding
    now rejects cross-tenant and cross-entity source/version collisions.

Before integration, compare each changed file against current main and rerun
the commands above plus target-branch PG and browser gates. Do not cherry-pick
an incomplete subset: the pipeline depends on the mapper, bridge, service,
adapter, and existing kernel ingress seams.

## Conflict points against `9c2b5a3` / integration tree

- `server/package.json`: test command registration; expect a mechanical merge
  conflict if main changed its test list.
- `server/runtime/wbs-inbound-data-adapter.mjs`: adds MCP provenance and the
  read-only proposal builder; reconcile with any concurrent adapter changes.
- Existing runtime contracts are consumed, not replaced. Confirm the target
  still exposes `recordWbsSnapshot` and `persistWbsInboundRows` before wiring
  the pipeline.
- All other added files are WBS inbound-specific and should have no AP/AR,
  JE, Banking, AI, or WBS-business-UI overlap.

## Explicit handoff decision

The complete chain is **integrable only as a fail-closed WBS inbound boundary**:
signed provider receipt -> Raw -> Normalized -> Staging/Exception ->
read-only AutoRec review evidence and control/trace evidence. It intentionally
does not integrate an importer with Draft JE, approval, posting, or WBS write
authority. Keep it excluded from a production release until the P0 provider
materials and independent end-to-end evidence are supplied.

## Acceptance after provider material arrives

1. Verify signature/key/receipt/version/replay binding without logging secrets.
2. Pull a nonempty scoped provider snapshot; reject missing/changed receipt,
   signature, scope, keys, amount/date/currency/direction, or mapping with zero
   persistence/dispatch.
3. Persist only Raw/Normalized/Staging/Exception evidence, then read it back
   by receipt/hash/source/version/company.
4. Compare the 12 golden control totals and forward/reverse trace to the
   persisted result.
5. Separately exercise the authoritative REFS AutoRec and JE workflow; only
   that workflow may produce Draft/Review/Approve/Post/ledger outcomes.
