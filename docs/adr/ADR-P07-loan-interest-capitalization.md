# ADR-P07 — Loan master, borrowing cost and interest capitalisation

Status: **Proposed → implemented for the deterministic core** (migration 431); variable rates, fees/amortised cost and loan disposal deferred to D-P07-1..5.
Session: claude-9c9cd162 · 2026-09-17 · depends on ADR-P05 (CWIP classification reuse).

## 1. Context — census

Everything that existed before this migration is read-side.

| Object | Where | Verdict |
|---|---|---|
| CWIP-style loan account rollforward | 078 `refs_get_construction_loan_rollforward`, 363 `refs_read_construction_loan_register` | Admits an account only when one APPROVED `CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION` mapping classifies it. Sound, but account-level only |
| AI evidence / proposals | 126, 199, 200, 219, 232, 247, 248, 259, 283, 296 | Classification evidence, entry *proposals*, lender balance reviews, draw→CWIP *policy reads*, decision chains. All proposal or read; none is a loan |
| Loan tables | `ai_construction_loan_classification_evidence`, `ai_construction_loan_entry_proposal`, `ai_loan_reference_finding` | AI artefacts, not master data |
| Loan master, rate, draw, accrual, capitalisation window | — | **None existed** |

Consequence: the system could report what someone posted to a loan account, but had no way to say what interest *should* be for a period, and no way to distinguish capitalised from expensed borrowing cost other than by reading the journal someone wrote.

## 2. Decision

1. **Loan master is approvable master data** (`loan_master`): lender member, facility, currency, annual nominal rate (six-decimal fraction), day-count basis (`ACT_360` | `ACT_365`), capitalisation window, the project it capitalises into, and three declared accounts (CWIP, interest expense, accrued interest). `DRAFT → APPROVED → RETIRED`, approver ≠ creator (function guard **and** table CHECK), CAS on `revision`, idempotent. The lender must be an active scoped member and every declared account must exist and be active (23503).
2. **A capitalisation window is all-or-nothing.** `capitalization_start`, `project_ref` and `cwip_account_code` are required together, enforced by a table CHECK and again at the HTTP edge. A loan with no window expenses all of its interest — there is no implicit default.
3. **Draws are approved facts** (`loan_draw`): positive = advance, negative = principal repayment. Cumulative APPROVED principal may not exceed the facility nor go negative, checked at create **and re-checked at approve** (two Drafts that each fit but do not fit together are caught at the second approval).
4. **The accrual is pure arithmetic, not an estimate.** For each day of the period: `outstanding(day) = Σ APPROVED draws with draw_date ≤ day`; `interest(day) = outstanding × annual_rate / basis_days`. Days inside the approved window go to `capitalized_amount`, the rest to `expensed_amount`. Each bucket is rounded once at the end so the two always sum to the rounded total. DRAFT draws never count. The response carries the whole computation plus its sha256 hash.
5. **The Draft is bound to the computation the maker reviewed.** `refs_create_loan_interest_draft` takes `expectedComputationHash`, recomputes, and refuses with **40001 → HTTP 412** if anything (a draw, the rate, the window) changed in between. **The amounts come from the recomputation, never from the request** — the command has no amount parameter at all. It then builds a MANUAL Draft journal (Dr CWIP for the capitalised part with the project dimension, Dr interest expense for the rest, Cr accrued interest against the lender member) and stops: Submit → Review → Approve → Post is unchanged.
6. **One Draft per loan per period** (unique constraint), so an accrual cannot be booked twice.
7. **Capitalised interest still needs an approved CWIP classification.** Even though the CWIP account is declared on the loan, the command re-checks the 077-family mapping at the journal date (23514 otherwise) — the declaration alone is not authority.
8. **The computation function carries no scope assertion**; the GL.REPORT.VIEW read wraps it, and the `LOAN.INTEREST.DRAFT` command calls it directly. (First implementation required the reporting permission inside the command — caught by the PG test and fixed, because a maker should not need a reporting grant to do their own job.)

New permissions: `LOAN.MASTER.VIEW` (READ), `LOAN.MASTER.CREATE` (DRAFT), `LOAN.MASTER.APPROVE` (APPROVE), `LOAN.INTEREST.DRAFT` (DRAFT).

## 3. API (OpenAPI 354 paths)

| Method | Path | Permission |
|---|---|---|
| GET | `/entities/{id}/loans` | LOAN.MASTER.VIEW |
| POST | `/entities/{id}/loans` | LOAN.MASTER.CREATE |
| POST | `/entities/{id}/loans/{loanId}/draws` | LOAN.MASTER.CREATE |
| POST | `/entities/{id}/loan-masters/{loans\|draws}/{objectId}/transitions` | LOAN.MASTER.APPROVE (If-Match CAS) |
| GET | `/entities/{id}/loans/{loanId}/interest-accrual?periodId` | GL.REPORT.VIEW (ETag = computation hash) |
| POST | `/entities/{id}/loans/{loanId}/interest-drafts` | LOAN.INTEREST.DRAFT + GL.JE.CREATE |

## 4. Worked numbers (from the tests, not from prose)

1,000,000 drawn 2026-07-01, 7.3% nominal:
- ACT/365 → 200.0000/day × 31 days = **6,200.0000**, all capitalised while the window is open.
- ACT/360 → 202.7778/day × 31 = **6,286.1111** (rounded once, not per day).
- Draw dated 2026-07-16 → 16 days → **3,200.0000**; opening principal 0, closing 1,000,000.
- Window closing 2026-07-10 → 10 capitalisable days / 21 expensed → **2,000.0000 + 4,200.0000 = 6,200.0000**.
- No window → 0 capitalised / 6,200.0000 expensed.
- DRAFT (unapproved) draw → total 0.

## 5. Deferred — Owner decisions

- **D-P07-1 variable / floating rates.** One fixed `annual_rate` per loan. A floating loan needs a rate schedule with approved effective dates; the accrual would then integrate over rate segments as well as draw segments. Not built.
- **D-P07-2 fees, OID and amortised cost.** No origination fee, commitment fee, or effective-interest amortisation. Borrowing cost here is nominal interest only.
- **D-P07-3 capitalisation ceiling.** IAS 23 / ASC 835-20 cap capitalised interest at actual borrowing cost and, for general borrowings, apply a weighted average rate to qualifying expenditure. This implementation capitalises *specific* borrowing on a declared window and does **not** compute a general-borrowings rate or a qualifying-expenditure ceiling. Using it for general borrowings would overstate capitalised interest.
- **D-P07-4 suspension of capitalisation.** A single window; no support for suspending during extended interruptions to construction. A second window would need the window to become a list.
- **D-P07-5 disposal / payoff.** A loan retires only after its draws retire; there is no payoff, write-off, refinancing or modification path, and no gain/loss on extinguishment.
- Interest is accrued, never paid here: settlement of accrued interest goes through the existing AP path against the lender member.

## 6. Tests (executed)

PG16 `server/tests/loan-interest-capitalization-postgres.test.mjs` **3/3**:
- masters: unknown lender and unknown account → 23503; idempotent replay; duplicate ref → 23505; draw before loan approval → 23514; self-approval → 42501; stale revision → 40001; facility breach at create **and** at approve; negative principal → 23514; masters read shows outstanding 600,000 with two draws; wrong scope → 42501; retire with live draws → 23514; lineage `LOAN:CREATED → LOAN:APPROVED → DRAW:CREATED → DRAW:CREATED → DRAW:APPROVED`; event DELETE → 55000.
- accrual: the six worked numbers above; stable hash across reads; unknown loan → P0002; foreign period → 22023; wrong scope → 42501.
- Draft: stale hash → 40001; non-maker → 42501; receipt carries 6,200.0000 capitalised; idempotent replay; **nothing in the ledger**; exactly two journal lines with the project dimension and the lender member; second Draft for the same period → 23505; posted through the four-eyes chain → ledger 150100 +6,200 / 292001 −6,200 and the accrual read shows `existing_draft.journal_status = POSTED` still pointing at the same computation hash; binding UPDATE → 55000; zero-interest period → 23514; unclassified CWIP account → 23514.

HTTP `server/tests/loan-interest-capitalization-http.test.mjs` **3/3**: bodyless/no-store reads, accrual ETag = computation hash, 10 rejected malformed loan bodies, all-or-nothing window at the edge, negative draw accepted, transition If-Match 428/412, kernel codes → 403/404/409/412/422/423, receipt-echo and status protocol breaches → 502, missing method → 503, and an assertion that the interest command carries **no amount field at all**.

## 7. Consequences

- The accrual read is now the only defensible answer to "what should July interest be?", and it is reproducible from approved master data alone.
- Because DRAFT draws are excluded, an unapproved draw silently reduces the accrual — visible in `computation.closing_principal`, and the reason the masters read exposes `outstanding_principal`.
- Day-level aggregation is O(days × draws) per read; fine at monthly granularity, revisit with P12 if a loan accumulates thousands of draws.
