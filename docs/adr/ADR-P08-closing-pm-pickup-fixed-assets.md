# ADR-P08 — Closing, PM Pickup and the fixed asset lifecycle

Status: **Audit + one minimal mergeable implementation** (migration 432: the missing impairment posting path). Closing and PM Pickup findings are recorded as gaps with Owner decisions, not implemented.
Session: claude-9c9cd162 · 2026-09-18.

## 1. Module-by-module census

### 1.1 Closing — **no business object**
The only artefact is 249 `refs_read_ai_closing_settlement_source`, an `AI.ANALYSIS.EXPLAIN` read over `source_document` rows with `source_module='closing'`. It infers a settlement type from `external_dimension_refs->>'signed_settlement_type'` or, failing that, from whether the document type matches `%SALE%`.

What "Settlement" means elsewhere in the repo is different and should not be confused with it: 304/305/306/401 are the **cash settlement of a business document** (`refs_create_native_settlement` accepts only `AP_PAYMENT` and `AR_RECEIPT`).

So: no closing statement object, no proration, no escrow, no payoff, no commission lines, no binding between a closing and the revenue / COGS / settlement entries it should produce. **Status: GAP, not implemented** (D-P08-2; also ADR-P06 D-P06-3).

### 1.2 PM Pickup — **a real but narrow object**
157 and 158 are genuine: `wbs_property_rent_source_admission`, `wbs_property_rent_review_evidence` and `wbs_property_rent_draft_evidence` (all append-only), `refs_review_wbs_property_rent` (reviewer), `refs_create_wbs_property_rent_draft` (`WBS.PROPERTY.RENT.DRAFT` + `GL.JE.AUTO.CREATE`, maker ≠ reviewer, idempotent) and `refs_list_wbs_property_rent_pickup`. The chain admission → review → Draft → normal posting exists and is evidence-bound.

Limits worth recording: it covers **rent pickup only** — no management fee, no reimbursable, no owner draw, no PM statement reconciliation; and the read is a list, not a period rollforward. **Status: PARTIAL, adequate, not extended here** (D-P08-3).

### 1.3 Fixed assets — **the most complete module in the repo, with exactly one hole**

| Stage | Command | Evidence / guards |
|---|---|---|
| Register | `refs_review_fixed_asset_register` (237) | independent review, `register_evidence_hash` |
| Acquisition | `refs_create_fixed_asset_acquisition` (341–356) | source binding, attachment snapshot, consumption guard, post guards |
| Depreciation | `refs_create_fixed_asset_depreciation` (355–357) | schedule snapshot, boundary + reconciliation guards |
| **Impairment** | **— missing —** | 242 review evidence + 243 posted reconciliation existed; **no command in between** |
| Post-impairment depreciation policy | `refs_review_fixed_asset_post_impairment_policy` (358/359) | blocks depreciation until reviewed |
| Disposal | `refs_create_fixed_asset_disposal`, `refs_review_fixed_asset_disposal` (334–337, 360) | ledger integrity, timeline, impaired disposal, source binding |

**The hole:** 242 records an independently reviewed `fixed_asset_impairment_assessment_evidence` row (posted carrying value, recoverable amount, derived `impairment_loss`, both account codes, hash). 243 reconciles that assessment against POSTED ledger lines. Nothing could create the journal in between — acquisition, depreciation and disposal each have a `refs_create_fixed_asset_*` Draft command; impairment had only the review and the reconciliation. In practice 243 reported every assessment as unposted, and the only way to impair an asset was a hand-written manual journal bound to nothing.

**A second, related defect (C-P08-1):** 243 keys its reconciliation on `dimensions->>'impairment_assessment_evidence_id'`, while nine other migrations (336, 337, 339, 340, 352, 357, 358, 359, 360) and the kernel fixtures key on `dimensions->>'fixed_asset_impairment_assessment_evidence_id'`. 243 is never replaced. Either spelling alone leaves one side blind.

## 2. Decision — migration 432, the minimal mergeable implementation

`refs_create_fixed_asset_impairment_draft(tenant, entity, assessment, number, date, expectedAssessmentHash, reason, attachments, key, hash)`:

- permission `FIXED_ASSET.IMPAIRMENT.DRAFT` (HIGH, sod_class `FIXED_ASSET_IMPAIRMENT_MAKER`, authority **DRAFT**) plus `GL.JE.CREATE`;
- the loss comes from the reviewed assessment — **the command has no amount parameter**; the maker echoes the assessment hash and gets **40001 → HTTP 412** if it drifted;
- **four eyes across the module boundary**: the reviewer who signed the assessment may not book it (42501);
- refuses (23514) when the assessment is not `INDEPENDENTLY_REVIEWED`, records no loss, belongs to a non-ACTIVE or already-disposed asset, or is **already reflected in the Posted ledger** (checked on either dimension spelling, so it cannot double-count);
- emits a MANUAL Draft (Dr impairment expense / Cr accumulated impairment) carrying **both** dimension spellings plus `fixed_asset_register_evidence_id`, `project_ref` and `property_ref` from the register's `member_trace` — deliberately, so both 243 and the nine long-key consumers see it, until the Owner picks one (C-P08-1 / D-P08-1);
- append-only `fixed_asset_impairment_draft_binding`, **one Draft per assessment** (unique), plus audit and outbox events;
- nothing posts: Submit → Review → Approve → Post, period control and SoD are unchanged.

## 3. Tests (executed)

PG16 `server/tests/fixed-asset-impairment-draft-postgres.test.mjs` **2/2** (fixture builds the real evidence chain: source document/line → classification evidence → capitalization proposal → register evidence → impairment assessment):
- guards: stale hash → 40001; reviewer books own assessment → 42501; no permission → 42501; unknown assessment → P0002; zero loss → 23514; and two constraint pins — the register status column admits only `ACTIVE`, and the assessment status only `INDEPENDENTLY_REVIEWED` (so 432's ACTIVE check is defence in depth);
- loop: receipt 5,000.0000 bound to the assessment hash; idempotent replay; second Draft → 23505; **nothing in the ledger**; exactly two lines carrying both dimension spellings, the register id, `PRJ-1` and `PROP-1`; **243 reports 0 posted before**, and after the Draft goes through the four-eyes chain the ledger shows 680200 +5,000 / 159200 −5,000 and **243 reports `posted_impairment_expense = 5000.0000` and `posted_accumulated_impairment = 5000.0000`** — the loop 242 → 432 → 243 closes for the first time; binding UPDATE → 55000; one audit row.

HTTP `server/tests/fixed-asset-impairment-draft-http.test.mjs` **1/1**: closed payload (6 malformed bodies + a missing field rejected), Idempotency-Key required, If-Match rejected, bad path uuid → 400, 40001 → 412, kernel codes → 403/404/409/422/423, two protocol breaches → 502, missing method → 503, and an assertion that the command carries **no amount or loss field**.

Contracts: router↔OpenAPI census, OpenAPI shape, router↔kernel, permission matrix (176), migration down symmetry — green. OpenAPI 355 paths.

## 4. Gaps left open (Owner decisions)

- **D-P08-1 / C-P08-1** unify the impairment assessment dimension spelling; until then 432 writes both. Fixing 243 forward is a one-line change but alters a published read's output, so it is not done unilaterally.
- **D-P08-2** Closing statement as a business object (proration, escrow, payoff, commissions, binding to revenue/COGS/settlement). Currently only an AI source read.
- **D-P08-3** PM Pickup beyond rent: management fees, reimbursables, owner draws, PM statement reconciliation, and a period rollforward read.
- **D-P08-4** Impairment reversal. IAS 36 permits reversal for non-goodwill assets; there is no reversal assessment or command, and `GL.JE.REVERSE` of the impairment Draft is the only unwind.
- **D-P08-5** Asset-to-project association is inherited from `member_trace` on the capitalization proposal and is not reconciled against the P05 project masters; an asset can carry a `project_ref` that is not a registered project.
