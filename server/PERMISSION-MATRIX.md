# Permission matrix (S29)

Generated from a fresh PG 16.4 database at the candidate head (`permission_catalog` ⋈ `runtime_human_permission_authority`); `fixtures/permission-matrix.json` is the machine copy and `tests/permission-matrix-contract.test.mjs` pins the invariants below against the migration SQL.

Totals: **167** permissions, **37** CRITICAL, **32** without a human authority class (service/AI/system only — a human grant of these is refused by 274/307).

## How allow / deny / SoD work (one rule set, three layers)

1. **Grant layer** (`runtime_actor_grant` ⋈ catalog, 274/307): an actor may hold at most one workflow *authority class* per entity (DRAFT | SUBMIT | REVIEW | APPROVE | POST …). A second class is refused at grant time — this is the "no maker-checker collapse" rule, tested in journal-lifecycle #10 and posting-sod #18.
2. **Command layer** (`refs_assert_scope`): every SECURITY DEFINER command names exactly one permission; missing → 42501 with zero writes (posting-sod #20/#21).
3. **Function-level SoD**: transition/post/reopen/sign-off re-check identity against the row (creator ≠ reviewer ≠ approver ≠ poster; closer ≠ reopener; sign-off ≠ reopener) even if grants were mis-issued (lifecycle #10, reconciliation :5337, period :4128).

Audit: every allowed command writes `audit_event(permission_used=…)` in the same transaction (posting-sod #17); denials write nothing and are counted by `accounting_access_failure` (S15).

## Key actions × role

| Action | Permission | Authority class | Risk | Who is denied (tested) |
|---|---|---|---|---|
| Create Draft JE | `GL.JE.CREATE` | DRAFT | HIGH | JE_MAKER |
| Submit | `GL.JE.SUBMIT` | SUBMIT | HIGH | JE_MAKER |
| Review | `GL.JE.REVIEW` | REVIEW | HIGH | JE_REVIEW |
| Approve | `GL.JE.APPROVE` | APPROVE | CRITICAL | JE_APPROVE |
| Post (maker/reviewer/approver denied 42501) | `GL.JE.POST` | POST | CRITICAL | JE_POST |
| Close period (readiness hash required) | `GL.PERIOD.CLOSE` | CLOSE | CRITICAL | PERIOD_CLOSE |
| Reopen period (closer denied) | `GL.PERIOD.REOPEN` | REOPEN | CRITICAL | PERIOD_REOPEN |
| Start reconciliation | `BANK.RECONCILIATION.START` | DRAFT | HIGH | BANK_RECONCILIATION_MAKER |
| Clear / unclear item | `BANK.RECONCILIATION.CLEAR` | DRAFT | HIGH | BANK_RECONCILIATION_MAKER |
| Review reconciliation | `BANK.RECONCILIATION.REVIEW` | REVIEW | HIGH | BANK_RECONCILIATION_REVIEWER |
| Sign off (locks items) | `BANK.RECONCILIATION.SIGN_OFF` | APPROVE | CRITICAL | BANK_RECONCILIATION_APPROVER |
| Reopen signed-off (CRITICAL, separate role) | `BANK.RECONCILIATION.REOPEN` | REOPEN | CRITICAL | BANK_RECONCILIATION_REOPENER |
| Post cash transfer | `CASH.TRANSFER.POST` | POST | CRITICAL | CASH_TRANSFER_POST |
| Create bill | `AP.BILL.CREATE` | DRAFT | HIGH | AP_BILL_MAKER |
| Void bill (423: APPROVED|OPEN) | `AP.BILL.VOID.CREATE` | AP_ADJUSTMENT_MAKER | CRITICAL | AP_ADJUSTMENT_MAKER |
| Approve void | `AP.BILL.VOID.APPROVE` | AP_ADJUSTMENT_APPROVE | CRITICAL | AP_ADJUSTMENT_APPROVE |
| Native payment | `AP.PAYMENT.CREATE` | PAYMENT | HIGH | AP_PAYMENT_MAKER |
| Create invoice | `AR.INVOICE.CREATE` | DRAFT | HIGH | AR_INVOICE_MAKER |
| Upload attachment | `ATTACHMENT.CREATE` | ATTACHMENT_UPLOADER | MEDIUM | ATTACHMENT_UPLOADER |
| Scanner finalize (service only) | `ATTACHMENT.FINALIZE` | — | HIGH | ATTACHMENT_SCANNER |
| Cleanup (service only) | `ATTACHMENT.CLEANUP` | — | HIGH | ATTACHMENT_CLEANER |
| WBS payable review | `WBS.PAYABLE.REVIEW` | REVIEW | HIGH | WBS_PAYABLE_REVIEWER |
| WBS cost→CWIP review | `WBS.COST.CWIP.REVIEW` | WBS_COST_CWIP_REVIEWER | HIGH | WBS_COST_CWIP_REVIEWER |
| WBS rent review | `WBS.PROPERTY.RENT.REVIEW` | WBS_PROPERTY_RENT_REVIEWER | HIGH | WBS_PROPERTY_RENT_REVIEWER |
| Post unit transfer | `REAL_ESTATE.UNIT_TRANSFER.POST` | POST | CRITICAL | UNIT_TRANSFER_POST |
| Post IC elimination | `GROUP.INTERCOMPANY_ELIMINATION.POST` | POST | CRITICAL | INTERCOMPANY_ELIMINATION_POST |
| Export posted ledger | `DATA.EXCHANGE.POSTED_LEDGER.EXPORT` | EXPORT | MEDIUM | POSTED_LEDGER_EXPORT |

## Service-only permissions (no human authority class)

`AI.PROPOSAL.CREATE`, `AI.ACCOUNTING.SETTINGS.VIEW`, `AI.ACCRUAL.VIEW`, `AI.AMORTIZATION.VIEW`, `AI.ANALYSIS.EXPLAIN`, `AI.CAPITALIZATION.VIEW`, `AI.EXPENSE.VIEW`, `AI.LOAN.VIEW`, `AI.TEST.WORKFLOW`, `AP.VIEW`, `AR.VIEW`, `ATTACHMENT.CLEANUP`, `ATTACHMENT.FINALIZE`, `AUDIT.VIEW`, `BANK.AUTOREC.G11.REVERSE`, `BANK.AUTOREC.G11.REVERSE_DRAFT`, `BANK.AUTOREC.SYNC`, `BANK.VIEW`, `CASH.TRANSFER.VIEW`, `FIXED_ASSET.DISPOSAL.VIEW`, `FIXED_ASSET.IMPAIRMENT.VIEW`, `FIXED_ASSET.REGISTER.VIEW`, `GL.JE.VIEW`, `GL.REPORT.VIEW`, `OUTBOX.DISPATCH`, `REAL_ESTATE.UNIT_TRANSFER.VIEW`, `WBS.AUTOREC.VIEW`, `WBS.BANK.ADMIT`, `WBS.COMPANY.CATALOG.VIEW`, `WBS.INSURANCE.PC_MAPPING.VIEW`, `WBS.SNAPSHOT.IMPORT`, `WBS.TEST.IMPORT`

## Gaps

- B5: base reconciliation transition still executable by `refs_app` (T10) — revoke pending Owner.
- B6: `self-service-read-grant/activate` grants READ without appearing in OpenAPI.
- No live read-back of grants on staging (needs `refs_grant_sync` role; S32).
