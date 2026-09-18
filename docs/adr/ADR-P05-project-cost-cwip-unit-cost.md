# ADR-P05 — Project cost, CWIP and Unit Cost layer

Status: **Proposed → partially implemented** (masters + derived cost-layer read: migration 429; capitalisation / transfer / unit-release *commands* deferred to Owner decisions D-P05-1..4).
Session: claude-9c9cd162 · 2026-09-17 · Candidate branch `claude/2026-09-16-n-batch-9c9cd162`.

## 1. Context — what actually exists today (census, not opinion)

| Concern | Where it lives | Verdict |
|---|---|---|
| Project / cost code / unit identity | `source_document_line.project_ref / property_ref / phase_ref / unit_ref` (001:191), `journal_line.dimensions` and `ledger_line.dimensions` keys `project_ref`, `cost_code_ref`, `unit_ref`, `property_ref` (free text) | **No master.** Nothing declares which refs exist, who approved them, or whether a cost code is capitalisable. A typo creates a new "project". |
| CWIP account identity | `mapping_snapshot` family `CWIP_ACCOUNT_CLASSIFICATION` (077), approved per exact account | Sound: CWIP is never inferred from names/prefixes. Kept as the *only* CWIP classification source. |
| CWIP rollforward | `refs_get_cwip_rollforward` (077) per account per period | Account-level only; no cost code / unit axis. |
| WBS cost → CWIP Draft | 132 review evidence → 133/138 `refs_create_wbs_cost_cwip_draft` (WBS.COST.CWIP.DRAFT + GL.JE.AUTO.CREATE, reviewer≠maker, idempotent) | A real capitalisation *event chain* exists for **WBS-sourced** cost only. |
| Invoice capitalisation proposal | 197 `ai_invoice_capitalization_proposal` (AI proposal, human review) → fixed-asset acquisition Draft (341–356) | Covers FIXED_ASSET treatment; CWIP treatment ends at the proposal. |
| Unit transfer | 370/371/405 `unit_transfer_*` (cross-entity carrying-value transfer, paired reversal, IC open items) | Transfers a unit's *carrying accounts* between entities; does not build or release a unit cost layer. |
| Lot / dimension profitability | 074, 134 reads | Report filters over `dimensions`; not a cost layer. |
| Loan draw → CWIP policy | 247/248/259/296 AI reads | Financing-cost side (P07). |
| UI "CWIP / Unit cost" pages | report workspaces | Filters over the reads above — **not an implementation** (task book P05). |

Conclusion: the ledger already *carries* project dimensions faithfully; what is missing is (a) a declarable, approvable master for those dimensions, (b) a derived layer read that reconciles ledger to master and flags what does not reconcile, and (c) controlled commands for capitalisation completion, cost transfer between codes/units and unit cost release. (a) and (b) have unambiguous semantics and are implemented in 429. (c) depends on business policy that is not in the repo and is deferred with explicit decision points.

## 2. Decision

1. **Masters are first-class, approvable, append-only-audited objects** (`project_master`, `project_cost_code`, `project_unit`, lineage `project_master_event`).
   - Lifecycle `DRAFT → APPROVED → RETIRED`; approver ≠ creator enforced by function guard *and* table CHECK; CAS on `revision`; idempotent by `Idempotency-Key` scope per command.
   - Permissions `PROJECT.MASTER.VIEW` (READ), `PROJECT.MASTER.CREATE` (authority class **DRAFT**), `PROJECT.MASTER.APPROVE` (authority class **APPROVE**) — reuse of the two existing human authority classes so that JE makers/approvers can hold them without violating the one-class-per-actor rule (274).
   - Cost codes and units can only be created under an **APPROVED** project; a project cannot retire while APPROVED cost codes/units remain.
   - `capitalization_policy` on the project (`CWIP_UNTIL_COMPLETION` | `EXPENSE_AS_INCURRED`) and `capitalizable` on the cost code are *declarations* the read reconciles against; they do not drive posting.
   - Unit `allocation_basis` (`AREA` | `EQUAL` | `SPECIFIC_IDENTIFICATION`) + `allocation_weight` are recorded now so a future release command has an approved basis; no allocation is computed yet.
2. **Cost layers are derived, never stored.** `refs_read_project_cost_layers(tenant, entity, project_ref, period?)` groups POSTED `ledger_line` by `(cost_code_ref, unit_ref, account_code)` for `dimensions.project_ref`, bounded by `journal_date ≤ period end`; `layer_class = CWIP` only when an APPROVED `CWIP_ACCOUNT_CLASSIFICATION` mapping classifies that exact account as of the period end; everything else `NON_CWIP`. Exceptions sort first: `PROJECT_NOT_REGISTERED`, `PROJECT_NOT_APPROVED`, `COST_CODE_MISSING`, `COST_CODE_NOT_APPROVED`, `UNIT_NOT_APPROVED`, `CWIP_ON_NON_CAPITALIZABLE_CODE`. Response carries `accounting_authority: NONE`, `can_capitalize / can_transfer / can_post: false`.
3. **No new posting path.** Capitalisation, cost transfer and unit release remain ordinary journals carrying dimensions through the unchanged Draft → Submit → Review → Approve → Post chain (period control 55000, SoD, audit). 429 adds zero automatic postings.
4. **Dimension keys are frozen** as `project_ref`, `cost_code_ref`, `unit_ref` (already used by 084/074/356). No renaming; no new keys.

## 3. Schema (429) — summary

```
project_master(project_id, tenant_id, entity_id, project_ref UNIQUE/entity, project_name, project_type, capitalization_policy, status, revision, created_by, approved_by≠created_by, retired_by …)
project_cost_code(cost_code_id, project_id→project_master, cost_code_ref UNIQUE/project, cost_category LAND|HARD|SOFT|FINANCING|MARKETING|OTHER, capitalizable, status, revision, …)
project_unit(unit_id, project_id, unit_ref UNIQUE/project, allocation_basis, allocation_weight>0, status, revision, …)
project_master_event(object_type, object_id, event_type CREATED|APPROVED|RETIRED, revision_after, actor_id, reason, snapshot, snapshot_hash)  -- append-only (reject_mutation)
```
Functions: `refs_create_project_master`, `refs_create_project_cost_code`, `refs_create_project_unit`, `refs_transition_project_master` (APPROVED|RETIRED), `refs_read_project_masters`, `refs_read_project_cost_layers`; each command writes `project_master_event` + `audit_event` (`PROJECT_MASTER_*`). `down/429` drops only its own objects and deactivates the three permissions.

## 4. API (OpenAPI 347 paths)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/entities/{id}/projects` | PROJECT.MASTER.VIEW | masters incl. cost codes & units |
| POST | `/entities/{id}/projects` | PROJECT.MASTER.CREATE | Idempotency-Key; 201/200 |
| POST | `/entities/{id}/projects/{projectId}/cost-codes` · `/units` | PROJECT.MASTER.CREATE | 422 unless project APPROVED |
| POST | `/entities/{id}/project-masters/{projects\|cost-codes\|units}/{objectId}/transitions` | PROJECT.MASTER.APPROVE | If-Match revision → 412; SoD → 403; retire guard → 422 |
| GET | `/entities/{id}/projects/{projectRef}/cost-layers?periodId` | GL.REPORT.VIEW | derived layers, exceptions first |

## 5. Event chain — implemented vs deferred

| Step | State |
|---|---|
| Declare project / cost code / unit; approve; retire; lineage; audit | **Implemented (429)** |
| Cost incurrence with dimensions (AP bill lines, manual JE, WBS cost CWIP Draft) | Existing paths; 429 makes them reconcilable |
| Layer read: ledger ↔ master ↔ CWIP mapping, exceptions | **Implemented (429)** |
| Capitalisation completion (CWIP → completed asset / inventory of units) | **Deferred — D-P05-1**: target account family and trigger (CO issuance? % complete?) not in repo |
| Cost transfer between cost codes / units within a project | **Deferred — D-P05-2**: needs approved allocation basis semantics; proposal: Draft JE generator that reads `project_unit.allocation_weight` and emits paired lines with dimensions, four-eyes chain unchanged |
| Unit cost release on sale (COGS) | **P06 / D-P06-x**; depends on D-P05-2 |
| Financing cost capitalisation into layers | **P07** |
| Evidence attachments on masters | Deferred — D-P05-3 (reuse `attachment` + `source_link`?); masters currently carry `reason` only |
| Backfill of existing dimension refs into masters | **D-P05-4**: 429 does *not* auto-register; the read shows `PROJECT_NOT_REGISTERED` / `COST_CODE_NOT_APPROVED` so the population is visible before any backfill decision. |

## 6. Test plan (executed)

- PG16 `server/tests/project-cost-master-postgres.test.mjs` **2/2**: SoD/CAS/idempotency/uniqueness/permission (42501, 23505, 40001, 23514), approval prerequisite, retire guard, lineage order `PROJECT:CREATED → PROJECT:APPROVED → COST_CODE:CREATED → UNIT:CREATED → COST_CODE:APPROVED`, append-only 55000, 5 audit rows; cost layers: CWIP by mapping only, net 560/200/… reconciles to `ledger_line` (880), six exception/clean layers, drafts excluded, unregistered project readable, period bound (0 layers before first posting), foreign period 22023, wrong scope 42501, read side-effect free.
- HTTP `server/tests/project-cost-master-http.test.mjs` **2/2**: bodyless/no-store reads, closed payloads, Idempotency-Key 400, If-Match 428, kernel codes 403/404/409/412/422, protocol 502.
- Contracts: router↔OpenAPI census, OpenAPI shape, router↔kernel surface, database dictionary, permission matrix, migration down symmetry — all green.

## 7. Consequences / risks

- Read cost is O(ledger lines for the project); fine for staging, index on `ledger_line((dimensions->>'project_ref'))` to be evaluated in P12 (100k perf) before production.
- Masters are entity-scoped; cross-entity projects (unit transfers 370) would need a tenant-level project identity — left explicit as a P06/P07 question.
- No UI yet; the report workspaces stay filters until D-P05-1/2 give them commands to expose.
