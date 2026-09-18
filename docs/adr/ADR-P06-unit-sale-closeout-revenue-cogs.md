# ADR-P06 — Unit sale close-out: revenue recognition and COGS release

Status: **Proposed → partially implemented** (close-out read model + specific-identification COGS release Draft: migration 430; revenue recognition policy and allocated-cost release deferred to D-P06-1..4).
Session: claude-9c9cd162 · 2026-09-17 · depends on ADR-P05 (migration 429).

## 1. Context — census

| Concern | Where it lives today | Verdict |
|---|---|---|
| Cash sale | `sales_receipt` (317–321, 400) native command + bank evidence/match | Real, controlled, posts revenue against a cash account |
| Credit sale | `business_document` `AR_INVOICE` + AR receipt / credit memo / refund (004, R04) | Real; state machine pinned by R04 |
| Settlement (closing statement) | 304 input reads, 305 `refs_create_native_settlement` (AP_PAYMENT / AR_RECEIPT only), 306 history, 401 bank control | Settlement means *cash settlement of a document*, **not** a real-estate closing statement |
| Real-estate closing statement | 249 `refs_read_ai_closing_settlement_source` — an AI read over `source_document` with `source_module='closing'` | **Read-only AI input. No closing object, no close-out posting.** |
| Revenue recognition over time / deferred revenue | `DEFERRED_REVENUE` exists only as an account *role* in approved COA settings (251/374) | **No rev-rec engine, no schedule, no release command** |
| COGS | — | **Nothing.** No account role, no command, no read; grep over 435 migrations finds no COGS object |
| Unit cost release | — | **Nothing** (ADR-P05 §1) |
| Unit transfer | 370/371/405 | Moves carrying value between entities; unrelated to sale |
| Reversal of a posted manual journal | `refs_create_journal_adjustment('REVERSAL')` (002:920, `GL.JE.REVERSE`), lines derived from the original | Exists and is the correct undo path for a release |

So the sale side is real (cash receipt, AR invoice), and the cost side of a sale did not exist at all. The missing piece with unambiguous semantics is: **for a unit whose cost is directly traced to it, release that cost to COGS when the unit's revenue is recognised, and let anyone see, per unit, whether that has happened.**

## 2. Decision

1. **Close-out is a derived read, never stored state.** `refs_read_unit_sale_closeout(tenant, entity, project_ref, period?)` reports per unit `capitalized_cost`, `cogs_released`, `revenue_recognized`, `gross_margin`, from POSTED ledger lines bounded by the period end. Because it is derived, reversing a release journal restores the unit automatically — no compensating master update, no drift.
2. **Account class is always an approved mapping, never a name.** CWIP keeps family `CWIP_ACCOUNT_CLASSIFICATION` (077). REVENUE and COGS come from the new `UNIT_SALE_ACCOUNT_CLASSIFICATION` family, approved per exact account, resolved with the same single-highest-priority rule; two equal-priority candidates resolve to *unclassified*, which surfaces as `ACCOUNT_CLASSIFICATION_MISSING`, not a guess.
3. **States and exceptions**: `UNSOLD`, `REVENUE_WITHOUT_COGS` (→ `COGS_NOT_RELEASED`), `COGS_WITHOUT_REVENUE` (matching principle violated — surfaced, never auto-fixed), `PARTIALLY_RELEASED` (→ `CAPITALIZED_COST_REMAINING`), `CLOSED_OUT`. Plus `UNIT_NOT_REGISTERED`, `UNIT_NOT_APPROVED`, `ACCOUNT_CLASSIFICATION_MISSING`. Exceptions sort first.
4. **The release is a Draft, never a posting.** `refs_create_unit_cogs_release_draft` builds an ordinary MANUAL journal through `refs_create_manual_journal` (Dr approved COGS / Cr approved CWIP, carrying `project_ref` + `unit_ref`) and stops. Submit → Review → Approve → Post is unchanged, so four eyes, period control (55000) and the audit trail all still apply. There is no AI and no automatic posting anywhere in this path.
5. **Refusals instead of guesses.** The command refuses (23514) when: the unit or its project is not APPROVED; the unit's `allocation_basis` is not `SPECIFIC_IDENTIFICATION`; either account lacks exactly one approved classification; **no revenue has been POSTED for the unit** (cost never precedes revenue); or the amount exceeds remaining capitalised cost *net of releases already drafted and not yet posted* (open Drafts reserve cost, so two Drafts cannot together over-release).
6. **Evidence.** `unit_cogs_release_binding` (append-only) records unit, accounts, amount, both mapping snapshot ids, and a `revenue_evidence` snapshot (revenue recognised, revenue journal count, capitalised cost posted, amount reserved by open Drafts) as of Draft time; plus `audit_event UNIT_COGS_RELEASE_DRAFT_CREATED` and an outbox event.

## 3. API (OpenAPI 349 paths)

| Method | Path | Permission |
|---|---|---|
| GET | `/entities/{id}/projects/{projectRef}/unit-sale-closeout?periodId` | GL.REPORT.VIEW |
| POST | `/entities/{id}/project-units/{unitId}/cogs-releases` | UNIT.COGS.RELEASE.DRAFT + GL.JE.CREATE |

New permission `UNIT.COGS.RELEASE.DRAFT` (HIGH, sod_class `UNIT_COGS_RELEASE_MAKER`, authority class **DRAFT**).

## 4. Deferred — Owner decisions

- **D-P06-1 allocated cost release.** `AREA` and `EQUAL` units are refused: no approved basis exists for splitting a shared cost pool across units. Deciding this (and D-P05-2) unlocks the general release.
- **D-P06-2 revenue recognition policy.** Point-in-time at closing vs. over time (percentage of completion) is not defined anywhere. Today revenue is whatever the AR invoice / sales receipt posted; there is no schedule object, no deferred-revenue release, and no contract-asset/liability presentation.
- **D-P06-3 closing statement as a business object.** 249 only reads `source_module='closing'` source documents for AI. A real close-out would bind the closing statement (proceeds, commissions, prorations, escrow, payoff) to the revenue, COGS and settlement entries as one reviewable package. Not built.
- **D-P06-4 credit notes / cancellations on a sold unit.** AR has no void/cancel (C26) and refunds are irreversible (C28); a cancelled unit sale therefore has no clean path. The close-out read will show `COGS_WITHOUT_REVENUE` if revenue is reversed while COGS stays, which is the correct alarm but not a remedy.
- **Known gap pinned:** a posted manual journal can only be reversed through `GL.JE.REVERSE` with lines derived from the original; there is no partial unwind. Adequate here, noted for P09.

## 5. Tests (executed)

PG16 `server/tests/unit-sale-closeout-postgres.test.mjs` **2/2**:
- states: U-101 `CLOSED_OUT` (cost 0 / COGS 600 / revenue 900 / margin 300), U-102 `PARTIALLY_RELEASED` with 250 left, U-103 `UNSOLD` + `ACCOUNT_CLASSIFICATION_MISSING` from one unclassified line, U-999 `UNIT_NOT_REGISTERED`; exceptions first; totals (4 units / 3 exceptions / revenue 1400 / COGS 750 / margin 650) tie to a direct `ledger_line` query; scope 42501; foreign period 22023; read leaves no audit row.
- release: refused before revenue exists; refused for an `AREA` unit; refused for unclassified source/target accounts; refused above the remaining cost; refused for a plain JE maker (42501); idempotent replay returns the same journal, key reuse with a different amount is 23505; the Draft is **not** in the ledger and the close-out does not move; an open Draft reserves cost (`available 300.0000`); both Drafts posted through the four-eyes chain → ledger COGS 800, unit `CLOSED_OUT`; `GL.JE.REVERSE` of one release → unit back to `PARTIALLY_RELEASED` with 300 capitalised and 300 releasable again; three append-only bindings with revenue evidence; binding UPDATE → 55000; three audit rows.

HTTP `server/tests/unit-sale-closeout-http.test.mjs` **2/2**: bodyless/no-store read, closed command payload (8 rejected malformed bodies), Idempotency-Key required, If-Match rejected, kernel codes → 403/404/409/422/423, two protocol breaches → 502, missing kernel method → 503.

Contracts: router↔OpenAPI census, OpenAPI shape, router↔kernel, permission matrix (171), migration down symmetry — green.

## 6. Consequences

- The close-out read is the first place where revenue and cost for a unit are compared at all; expect it to show real exceptions on any imported population (that is the point).
- `COGS_WITHOUT_REVENUE` can only arise from a manual journal or a revenue reversal; it is reported as an exception rather than blocked, because blocking would require the read to become a write guard.
- Performance shares P05's concern: both reads scan the project's POSTED lines. Index decision belongs to P12.
