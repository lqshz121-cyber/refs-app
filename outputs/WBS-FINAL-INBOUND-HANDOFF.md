# WBS Finance-to-REFS inbound handoff

## Status

This handoff describes a **local, test-verified inbound boundary**. It is not
production acceptance, a live WBS import, or authority to post a journal.

- Worktree: `C:\Users\lqshz\Documents\Codex\2026-08-01\re\work\refs-wbs-final-inbound`
- Integration base: `9c2b5a3` (`origin/main` at worktree creation)
- Current WBS inbound candidate: `2949c4627f2a660cd21688b3df355c65000013bd`
  (parent `9925cce9bcc3da661494ae2f3396bbcf85dc9881`; clean worktree verified).
- This candidate includes the earlier inbound series through `bdbbdc5`, plus
  production-signature and strict-decimal hardening listed below.
- Candidate commits: recorded in the integration order below.
- Live WBS signed, nonempty receipt: **UNKNOWN**.

## Delivered inbound capabilities

| Area | Delivered behavior | Key files |
| --- | --- | --- |
| Formal MCP lineage | Classifies Payable, Bank Transaction, and AutoRec Detail as possible transaction input; classifies AutoRec Bank, Journal Entry, Cost GL, Property Comparison, and trace as control/trace evidence. | `server/runtime/wbs-mcp-inbound-lineage.mjs`, `server/WBS-MCP-INBOUND-LINEAGE.md` |
| Field admission map | Maps each upstream WBS field family into Raw/Normalized/Staging, non-dispatchable AutoRec review, or control/trace evidence; records prohibited joins and actions. | `server/WBS-REFS-FIELD-ADMISSION-MAP.md` |
| Equivalence acceptance matrix | Separates local tests, observed WBS facts and external proof required for Payable, Bank, AutoRec, Cost GL, Property, controls, state, JE/G11, and trace release gates. | `server/WBS-AUTOREC-EQUIVALENCE-ACCEPTANCE-MATRIX.md` |
| Direct-source evidence register | Records observed WBS table and field metadata plus aggregate-only relationship checks; separates verified schema facts from unverified semantic/foreign-key claims and defines the provider evidence needed before any direct mapping. | `server/WBS-READONLY-SOURCE-EVIDENCE.md` |
| External accounting trace | Retains Payable posting/journal/check context, Bank transaction/payee/memo context, and AutoRec detail release/incur/AUTOC relations for reviewer trace only. No retained trace field is a REFS key, state transition, or posting authority. | `server/runtime/wbs-mcp-inbound-lineage.mjs`, `server/runtime/wbs-inbound-data-adapter.mjs` |
| Reverse trace lookup | Requires a read-only REFS persisted-source read that exactly matches tenant/entity/company/key/version/receipt, then queries `trace_by_key`. It rejects display/relation fields as lookup substitutes and returns relation evidence only. | `server/runtime/wbs-mcp-inbound-service.mjs` |
| Snapshot safety | Requires one company, one capture timestamp, stable ascending keys, canonical hashes, and no duplicate producer views. Missing keys in a later snapshot are `ABSENT_UNCONFIRMED`, never deletions. | `server/runtime/wbs-mcp-inbound-lineage.mjs` |
| Receipt-to-staging bridge | Converts eligible formal MCP envelopes to the existing receipt-backed WBS Raw -> Normalized -> Staging ingress shape; preserves per-envelope and per-row hash provenance and quarantines impossible calendar dates before Staging. | `server/runtime/wbs-mcp-inbound-lineage.mjs`, `server/runtime/wbs-inbound-data-adapter.mjs` |
| Inbound orchestration | Pulls only Payable, Bank Transaction, and AutoRec Detail through an injected read-only client; validates company and snapshot consistency. | `server/runtime/wbs-mcp-inbound-service.mjs` |
| Control and trace reads | Separately pulls only AutoRec Bank, WBS Journal Entry, Cost GL total, or trace relation evidence; none may enter transaction persistence. | `server/runtime/wbs-mcp-inbound-service.mjs` |
| Signed pipeline | Pull -> independent detached-signature verification -> admission -> existing receipt-backed persistence. Signature/admission failure occurs before persistence. | `server/runtime/wbs-mcp-inbound-pipeline.mjs` |
| Production admission hardening | Production snapshots are prepared only through the adapter's asynchronous pinned-key verification path; the MCP pipeline cannot call the legacy synchronous preparation seam. | `server/runtime/wbs-inbound-data-adapter.mjs`, `server/runtime/wbs-mcp-inbound-pipeline.mjs` |
| Strict monetary controls | Empty, null, boolean, and display-style numeric inputs are rejected instead of being coerced to zero in AutoRec controls, MCP source/control rows, Cost GL, and Property Comparison reconciliation. | `server/runtime/wbs-inbound-autorec-projection.mjs`, `server/runtime/wbs-mcp-inbound-lineage.mjs`, `server/runtime/wbs-control-reconciliation.mjs` |
| AutoRec proposal | Produces read-only, review-required match proposals and totals; does not reserve, allocate, release, incur, create Draft JEs, or post. | `server/runtime/wbs-inbound-data-adapter.mjs` |
| Posted AutoRec evidence | Reads the scoped reviewed candidate and posted evidence from an injected read-only kernel repository, then verifies one posted `PAYABLE_INCUR` and one posted `AUTOC` leg, their audit/ledger/source trace, and per-member `291001` net zero. | `server/runtime/wbs-inbound-data-adapter.mjs`, `server/runtime/wbs-inbound-autorec-read-composition.mjs` |
| Report controls | Cost GL requires exactly 14 immutable receipt-backed metrics and an exact approved mapping; Property Comparison uses an exact approved scoped mapping. They cannot become source documents or journals. | `server/runtime/wbs-control-reconciliation.mjs` |
| Golden coverage | Provides 12 sanitized/local matching scenarios and control/trace assertions. | `server/tests/wbs-autorec-golden-scenarios.test.mjs` |

## Verified test evidence

Run from `C:\Users\lqshz\Documents\Codex\2026-08-01\re\work\refs-wbs-final-inbound\server`:

```powershell
node --test tests/wbs-mcp-inbound-pipeline.test.mjs tests/wbs-mcp-inbound-service.test.mjs tests/wbs-inbound-data-adapter.test.mjs tests/wbs-mcp-inbound-lineage.test.mjs
npm.cmd test
git -C .. diff --check
```

At current candidate `2949c46`, the following focused commands exited
`0`: AutoRec projection `13/13`, MCP lineage `14/14`, Cost/Property
control reconciliation `8/8`, and MCP pipeline plus inbound adapter
`15/15`. Root `npm.cmd test` and `git diff --check` also exited `0`.
Rerun all commands after integration. These are local tests with injected
provider/kernel seams, not a production gate.

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
  and the names/semantics of the fourteen Cost GL metrics remain unverified.
- The observed WBS accounting journal table has a non-unique `cb_id` (multiple
  journal lines per shared bank-record relation) and cannot substitute for the
  immutable Bank Transaction producer. The provider must expose the actual
  bank-record receipt/key separately; REFS may use accounting rows only as
  journal/ledger trace evidence.
- The observed Payable-to-accounting relation is receipt-bound `cb_id` trace;
  tested Payable long-ID and journal-number joins had zero matches. Neither
  display/reference field may be promoted to a REFS source or match key.
- WBS accounting history and period-close/report-check tables provide no
  approved revision/CDC/tombstone chain. Their history, `Y/N` close and
  Balance/Income check fields remain external control evidence; REFS snapshot
  hashing and its own period-close state machine remain mandatory.
- `match_business_info` is multi-business. Only observed `AUTOC`, `AUTOP` and
  `AUTOR` rows can bind `MB_BusinessId` to an AutoRec Detail `pd_guid`; batch
  values do not bind to PB or Detail batches. This relation needs its own
  signed receipt and remains trace-only, not allocation/state authority.
- AutoRec Detail direction requires exactly one non-zero Deposit/Payment;
  zero/zero remains an Exception. PB amounts disprove a universal simple
  per-row Released/Incurred capacity formula and lack M/R/C periods on some
  rows, so provider-scoped signed control formulas remain mandatory.
- Read-only metadata now proves the primary-key and field inventory for the
  WBS Payable, AutoRec Detail, AutoRec Bank, matching, bank-account and
  payment-setting tables, plus the WBS accounting journal/audit/monthly and
  balance/income control tables, Property relation/unit-report candidates, and
  Cost/account-setting candidates. Aggregate checks disprove the proposed
  `pd_batchguid -> PB_GuId` and `MB_BatchGuId -> PB_GuId` joins. The register
  documents these as negative evidence; no direct table mapping is authorized
  until provider receipt/version, relationship/cardinality and semantic proof
  are supplied.
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
18. `533f05cc9eddd4920239f2dbca36a24886214df1` -- twelve explicit accounting
    boundary golden scenarios, including report-as-source and WBS-state blocks.
19. `6c4da2bd397ae6e1c57e234258dd4845482f0c7d` -- Cost GL accepts exactly
    fourteen metrics, never a partial metric set.
20. `7d874414c033e7f072f7bed3f1a44987d5f28e21` -- Payable external accounting
    trace retained with explicit no-key/no-posting authority flags.
21. `78392da79a4cea611455f1d0b0436ab54dc61e0a` -- Bank Transaction external
    trace retained with explicit no-key/no-release authority flags.
22. `c4b6037bbc1c5ba77d218ae7ba84ad80cff7e67f` -- AutoRec Detail external
    trace retained; WBS release/incur status cannot advance REFS state.
23. `07abaf186447914f7009ef1b26c82a429dd5928b` -- reverse `trace_by_key`
    lookup requires a persisted immutable source key/version/receipt and
    remains relation evidence only.
24. `7417aca65978106838da46cdd18eef4646cb0ff2` -- impossible source/posting calendar dates
    are quarantined before staging or any accounting request.
25. `bfeb1bb309155c1ed2abfe863b7d617ff2719168` -- reverse trace requires an
    exact read-only persisted-source lookup before it can query WBS.
26. `d2519d331e951e4b989546032a67d775bd889ac6` -- G11 validates both posted
    AutoRec JE legs, their audit/source/ledger trace, and per-member 291001.
27. `4931d1ca96f94ea42e332bb3e4a7bfbe1fe304df` -- G11 reads the candidate and
    posted journal evidence from a scoped, read-only kernel repository.

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

## Addendum: source-backed final changes through `3cb6ef6`

The original series list above ends at the initial G11 reader. The following
contiguous commits are also required; they carry the final source-evidence
constraints and the corrected handoff state:

1. `06ef8d0` documents kernel-backed G11 reads.
2. `8e3f6af` refreshes the handoff, followed by `7201ab0`, `27e760e`, and
   `0224f88`, which freeze source-schema, AutoRec and accounting-trace facts.
3. `d48f720`, `6f4214b`, and `f8d9cc1` separate Property/Cost control evidence,
   Bank record evidence, and Payable trace from transaction/posting authority.
4. `6749f4a` makes missing CDC/tombstone semantics an explicit snapshot-control
   limitation; `9739126` makes matching relations trace-only.
5. `3cb6ef6` enforces AutoRec Detail direction evidence: exactly one signed
   non-zero Deposit or Payment is required; both-nonzero and zero/zero rows
   are exceptions. It also preserves the provider-formula requirement for PB
   control amounts.
6. The next WBS-owned change requires a receipt-bound, scoped provider
   `ROW_SUM` formula before AutoRec Bank PB summaries can be accepted as
   control totals. It is still evidence-only and has no release/incur/Draft/
   post capability.
7. `99a6b4f` exposes that contract only through the read-only WBS service;
   it adds no persistence, allocation, release, incur or journal path.
8. `a67bddd` blocks all Bank Transaction snapshot admission without a
   receipt-bound per-account debtor/lender direction convention. REFS no
   longer assumes WBS column names determine accounting direction.
9. `e9aeb7a` applies the same rule to Payable Report amounts: every `ap_type`
   needs a receipt-bound direction convention before a report amount can be a
   business-side AutoRec source.
10. `300644b` applies it to AutoRec Detail: every `biz_type` needs a
    receipt-bound Deposit/Payment direction convention as well as the
    existing exactly-one-non-zero movement check.
11. `30f8436` adds an explicit observed WBS workflow contract. Its four page
    steps remain read-only evidence; the canonical WBS transition graph is
    UNKNOWN and no WBS status can transition, release, incur, draft, or post
    in REFS.
12. `db15d88` makes provider-backed AutoRec review plans take their date window
    and amount tolerance from one approved, receipt-bound REFS matching policy;
    importer/UI parameters cannot widen a policy.
13. `5dd20a2` binds every bank-side and business-side source to the exact
    approved mapping versions named by that matching policy; correct amounts
    with incorrect accounting mappings are blocked.
14. `dc23ee8` retains receipt-supplied WBS Detail/Match status codes as bounded
    `UNVERIFIED_SOURCE_CODE` evidence. It rejects malformed codes and never
    translates them into a REFS transition.
15. `bdbbdc5` requires tenant/entity scope for Cost GL controls and
    tenant/entity/property scope for Property Comparison controls, preventing
    cross-entity or cross-property evidence from reconciling.

The directly consumable integration range is therefore exactly
`6843dce^..bdbbdc5`, applied in Git order. It includes no WBS business UI,
WBS write operation, Draft-JE dispatch, approval or posting implementation.

## Current hardening commits after the original range

Apply these only after the preceding WBS inbound series has been reconciled
onto the target main branch:

1. `a9c96fa` — production snapshots require detached-signature verification
   before inbound preparation.
2. `f342bd7` — direct synchronous production preparation is rejected; the
   verified async path is the only production ingress route.
3. `deb6234` — Company Screening / M-R-C control fields reject missing
   monetary values rather than coercing them to zero.
4. `f018c17` — the formal MCP Payable/Bank/AutoRec/control mapper applies
   the same strict decimal rule.
5. `9925cce` — Cost General Ledger and Property Comparison metrics apply
   the same strict decimal rule.
6. `2949c46` — MCP pipeline requires `prepareVerified`; no composition
   may fall back to the synchronous preparation seam.

These commits remain WBS inbound-only. They do not create a WBS business UI,
call a WBS write operation, dispatch a Draft JE, approve, or post.

## Current conflict and ownership check

`origin/main` still resolves to `9c2b5a3fcb9cb94655909ed288e041361e9c998c` in
this worktree. The candidate was produced from that exact base. Its changed
files are restricted to WBS runtime contracts, WBS tests, WBS documentation
and the server test registration. Any integration conflict in the WBS runtime
files must preserve the receipt/hash/scope fail-closed checks; AP/AR, Banking,
JE, QB and AI owner files are outside this handoff.
