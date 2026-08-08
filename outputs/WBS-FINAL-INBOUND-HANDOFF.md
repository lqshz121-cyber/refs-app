# WBS Finance-to-REFS inbound handoff

## Status

This handoff describes a **local, test-verified inbound boundary**. It is not
production acceptance, a live WBS import, or authority to post a journal.

- Worktree: `C:\Users\lqshz\Documents\Codex\2026-08-01\re\work\refs-wbs-final-inbound`
- Integration base: `9c2b5a3` (`origin/main` at worktree creation)
- Candidate commits: recorded in the integration order below.
- Live WBS signed, nonempty receipt: **UNKNOWN**.

## Delivered inbound capabilities

| Area | Delivered behavior | Key files |
| --- | --- | --- |
| Formal MCP lineage | Classifies Payable, Bank Transaction, and AutoRec Detail as possible transaction input; classifies AutoRec Bank, Journal Entry, Cost GL, Property Comparison, and trace as control/trace evidence. | `server/runtime/wbs-mcp-inbound-lineage.mjs`, `server/WBS-MCP-INBOUND-LINEAGE.md` |
| Snapshot safety | Requires one company, one capture timestamp, stable ascending keys, canonical hashes, and no duplicate producer views. Missing keys in a later snapshot are `ABSENT_UNCONFIRMED`, never deletions. | `server/runtime/wbs-mcp-inbound-lineage.mjs` |
| Receipt-to-staging bridge | Converts eligible formal MCP envelopes to the existing receipt-backed WBS Raw -> Normalized -> Staging ingress shape; preserves per-envelope and per-row hash provenance. | `server/runtime/wbs-mcp-inbound-lineage.mjs`, `server/runtime/wbs-inbound-data-adapter.mjs` |
| Inbound orchestration | Pulls only Payable, Bank Transaction, and AutoRec Detail through an injected read-only client; validates company and snapshot consistency. | `server/runtime/wbs-mcp-inbound-service.mjs` |
| Signed pipeline | Pull -> independent detached-signature verification -> admission -> existing receipt-backed persistence. Signature/admission failure occurs before persistence. | `server/runtime/wbs-mcp-inbound-pipeline.mjs` |
| AutoRec proposal | Produces read-only, review-required match proposals and totals; does not reserve, allocate, release, incur, create Draft JEs, or post. | `server/runtime/wbs-inbound-data-adapter.mjs` |
| Report controls | Cost GL and Property Comparison reconcile only with immutable receipts and exact approved mappings. They cannot become source documents or journals. | `server/runtime/wbs-control-reconciliation.mjs` |
| Golden coverage | Provides 12 sanitized/local matching scenarios and control/trace assertions. | `server/tests/wbs-autorec-golden-scenarios.test.mjs` |

## Verified test evidence

Run from `C:\Users\lqshz\Documents\Codex\2026-08-01\re\work\refs-wbs-final-inbound\server`:

```powershell
node --test tests/wbs-mcp-inbound-pipeline.test.mjs tests/wbs-mcp-inbound-service.test.mjs tests/wbs-inbound-data-adapter.test.mjs
npm.cmd test
git -C .. diff --check
```

Before this handoff document was added, the first command exited `0` with
`13/13` tests passing and the second exited `0` with `226/226` tests passing.
The final candidate SHA and clean-worktree evidence must be recorded after the
handoff commit is made; do not substitute these local results for a production
gate.

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
6. **Final pipeline/handoff commit:** record its SHA after committing this
   worktree. It adds the signature-to-staging pipeline, tests, package test
   registration, and this handoff.

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
