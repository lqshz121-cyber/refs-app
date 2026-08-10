# REFS WBS Mock Accounting Readiness Pack

Status: local mock readiness only. This pack is designed so the future real WBS MCP adapter can replace the mock connector without rewriting the accounting logic. It is not a production WBS receipt, not a live provider test, and not a global release approval.

## 1. WBS MCP Data Contract

Authoritative code seam: `src/wbs-accounting-foundation.js`.

Required contract objects:

| Contract | Purpose | Minimum common fields |
| --- | --- | --- |
| Entity | Legal entity, currency, status and audit identity | id, external_source_id, source_system, status, created_at, updated_at, audit_trail_id |
| Project | Construction or operating project scope | common accounting fields plus project_code, project_name, completion_date |
| Property | Unit, lot or property scope | common accounting fields plus lot, unit, address |
| Vendor | Supplier, lender, contractor or service counterparty | common accounting fields plus vendor_id, vendor_name, vendor_type |
| CustomerTenant | Tenant, owner or receivable counterparty | common accounting fields plus customer_id, customer_name, tenant_status |
| ChartOfAccounts | Posting account source | common accounting fields plus account_code, account_name, account_type |
| BankTransaction | Bank statement line | common accounting fields plus bank_account_id, direction, memo, match_status |
| PayableInvoice | AP invoice or payable report line | common accounting fields plus vendor_id, invoice_number, invoice_date, due_date, open_amount |
| PayablePayment | AP payment source | common accounting fields plus vendor_id, invoice_id, bank_transaction_id, payment_status |
| CostGLTransaction | WBS cost general ledger source | common accounting fields plus vendor_id, cost_code, cost_class, capitalization_status |
| ConstructionLoan | Loan master and statement control | common accounting fields plus lender_vendor_id, loan_number, loan_status, lender_balance, gl_balance |
| LoanTransaction | Draw, interest, fee or repayment source | common accounting fields plus loan_id, loan_transaction_type, memo |
| PropertyOperation | Property-management operating metric | common accounting fields plus operation_type, metric_name |
| PropertyTaxStatement | County or local tax assessment source | common accounting fields plus vendor_id, document_type, statement_number, jurisdiction, tax_year, assessment period, due date and payment state |
| RentRoll | Rent roll source | common accounting fields plus customer_id, lease_id, scheduled_rent |
| ResidentActivity | Tenant activity source | common accounting fields plus customer_id, activity_type |
| ClosingStatement | Closing and settlement source | common accounting fields plus closing_type, settlement_agent |
| SourceDocument | Immutable source support | common accounting fields plus document_type, document_hash, storage_ref |
| JournalEntry | Header for REFS journal workflow | common accounting fields plus je_id, je_number, posting_status, review_status |
| JournalEntryLine | Debit or credit line | common accounting fields plus je_id, line_number, account_code, debit_amount, credit_amount |
| AIFinding | Deterministic accounting finding | common accounting fields plus rule_id, risk_level, reason, suggested_action, owner, due_date |
| AIRuleResult | Rule execution record | common accounting fields plus rule_id, object_type, object_id, result_status |
| AmortizationSchedule | Prepaid amortization control | common accounting fields plus schedule_id, coverage_start, coverage_end, monthly_amount |
| AccrualSchedule | Month-end accrual control | common accounting fields plus schedule_id, accrual_type, reversal_period |

Adapter rule: UI and accounting logic must consume only validated contract collections. The current registry reports partial coverage; an unsupported or invalid collection remains unavailable and cannot be inferred from a nearby mock collection. Production WBS must prove a signed nonempty receipt before data is admitted.

## 2. Database Architecture and Mock Persistence

Current implementation is a mixed local prototype plus server kernel. The mock-ready schema should map to the following tables:

| Table | Current source | Future storage owner |
| --- | --- | --- |
| entity_master | `ENTITIES`, WBS mock `entities` | Accounting Kernel |
| project_master | `PROJECTS`, WBS mock `projects` | Accounting Kernel |
| property_master | `PROPERTIES`, WBS mock `properties` | Accounting Kernel |
| vendor_master | `VENDORS`, WBS mock `vendors` | Accounting Kernel |
| customer_master | WBS mock `CustomerTenant`, local AR seed | Accounting Kernel |
| chart_of_accounts | `COA`, `WBS_COA_MAP`, WBS mock `ChartOfAccounts` | Accounting Kernel |
| accounting_periods / close_periods | local periods and server period controls | Accounting Kernel |
| source_documents | `SOURCE_DOCS`, WBS mock `sourceDocuments` | Attachment and Source Document owners |
| source_transactions | WBS mock source collections | WBS adapter owner |
| bank_accounts / bank_transactions / bank_matches | local bank module and WBS mock `bankTransactions` | Banking owner |
| payable_invoices / payable_payments | local AP module and WBS mock payable collections | AP owner |
| construction_loans / loan_transactions | local loan module and WBS mock loan collections | Loan owner |
| cost_gl_transactions / property_operations | local property and cost modules | Cost GL owner |
| property_tax_statements | WBS mock `propertyTaxStatements` | WBS adapter and Accrual owners |
| accounting_events | `buildAccountingEvents` output | AI Accounting owner |
| journal_entries / journal_entry_lines | local JE workflow and server kernel | JE owner |
| recurring_journal_entries | local recurring review | JE owner |
| amortization_schedules / amortization_schedule_lines | `createAmortizationScheduleFromInsurance` output | Amortization owner |
| accrual_schedules | Accrual Center draft controls | Accrual owner |
| intercompany_mappings / account_mapping_rules | local settings and mappings | Accounting Settings owner |
| ai_accounting_rules / ai_rule_results / ai_findings | deterministic rule engine output | AI Accounting owner |
| audit_logs / review_workflows | repo audit plus server audit trail | Kernel and AI owners |
| financial_statement_snapshots / report_definitions | report impact and local reports | Reports owner |
| user_permissions | local role shells plus server authorization | Security owner |

Persistence rule: local UI state may simulate workflow while external services are missing, but all mutation-like screens must either go through a controlled command boundary or remain visibly unavailable.

## 3. WBS Mock Connector Coverage

Authoritative mock connector: `createWbsMockConnector()` in `src/wbs-accounting-foundation.js`.

Current scenario coverage:

| Scenario | Mock evidence | Expected accounting treatment |
| --- | --- | --- |
| Twelve-month insurance payment | `AP-INS-12MO`, `DOC-INS-12MO`, `BANK-INS-PAY` | Prepaid asset and 12-line amortization schedule |
| Payable invoice without GL entry | `AP-ACCRUAL-01`, `DOC-AP-MISSING-GL` | Reviewed accrual candidate, guarded standard mock JE posting, GL and report trace |
| Bank payment without invoice match | `BANK-UNMATCHED-01`, `DOC-BANK-UNMATCHED` | Missing AP exception queue |
| Construction loan draw without local loan payable | `BANK-LOAN-DRAW-01`, `LOAN-DRAW-01`, `DOC-LOAN-DRAW` | Loan draw recognition and loan payable JE |
| Loan interest should be capitalized | `LOAN-INT-01`, `COST-INTEREST-EXPENSED` | Capitalized-interest review |
| Duplicate invoice risk | `AP-DUP-01`, `AP-DUP-02` | Duplicate invoice blocker |
| Completed project still capitalizing cost | `COST-POST-COMPLETE-01`, `PROJ-DONE-01` | Cutoff and capitalization review |
| Rent roll does not tie to GL revenue | `RENT-JULY-01`, `OPS-JULY-01` | Revenue mismatch finding |
| Loan statement does not tie to GL loan balance | `LOAN-HOU-01` | Loan reconciliation risk |
| Elapsed unpaid property tax | `PTAX-TRAVIS-2026`, `DOC-PROPERTY-TAX-2026` | Prorated seven-month property tax accrual, reviewed Draft JE, guarded mock posting, GL and report trace |
| Paid future-period property tax | `PTAX-TRAVIS-2027-PREPAID`, `DOC-PROPERTY-TAX-2027-PREPAID` | Prepaid property tax Draft JE; remains review-only and is never auto-posted |

Known gap: explicit intercompany wrong-entity payment is contract-ready but not yet represented as a full WBS mock source row. Property tax now has adapter-shaped mock accrual and prepaid records; these remain local mock evidence and do not represent a real WBS receipt.

## 4. AI Accounting Rule Engine

Authoritative rule engine: `runDeterministicAccountingRules()`.

Rules currently covered:

| Rule | Trigger | Output |
| --- | --- | --- |
| PREPAID_SCHEDULE_REQUIRED | Coverage period spans multiple months | High-risk finding, prepaid suggested JE, amortization schedule |
| PAYMENT_WITHOUT_BILL | Bank debit has no payable support | High-risk finding, exception workflow |
| LOAN_DRAW_RECOGNITION | Bank credit or loan transaction indicates lender draw | Medium-risk finding, balanced Draft JE |
| INTEREST_CAPITALIZATION_REQUIRED | Loan interest during active construction | High-risk finding, capitalized-interest Draft JE |
| ACCRUAL_CANDIDATE | Open invoice has no posted GL source | High-risk finding and accrual Draft JE |
| DUPLICATE_INVOICE_RISK | Same vendor, invoice number and amount | High-risk blocker |
| CWIP_POST_COMPLETION_CUTOFF | Completed project still receives capitalized cost | High-risk cutoff review |
| LOAN_BALANCE_MISMATCH | Lender statement differs from GL loan balance | High-risk reconciliation finding |
| RENT_ROLL_REVENUE_MISMATCH | Rent roll differs from GL revenue | High-risk revenue finding |
| MISSING_SOURCE_DOCUMENT | JE lacks source document | Posting blocker |
| JE_CONTROL_FAILURE | JE debit does not equal credit | Save/post blocker |
| MANUAL_JE_LARGE_NO_ATTACHMENT | Large manual JE lacks attachment | High-risk review |
| PROPERTY_TAX_ACCRUAL_REQUIRED | Unpaid assessment months have elapsed through the close | Prorated property tax expense/AP Draft JE and controller review |
| PROPERTY_TAX_PREPAID_REQUIRED | Paid assessment applies entirely after the close | Prepaid property tax/cash Draft JE and future expense review |

Rule output must keep rule_id, rule_name, risk_level, object_type, object_id, reason, suggested_action, suggested_je, confidence_score, owner, due_date, status and audit_trail.

## 5. QuickBooks Gap Backlog

REFS aligns to QuickBooks Online Advanced only where it helps the real-estate close.

| QB feature | REFS current status | Gap | Priority | Implementation plan | Route/page | Data/API needed |
| --- | --- | --- | --- | --- | --- | --- |
| Quick Create | Local domain actions only | Consumer payroll/payment actions removed | P1 | Keep Create invoice and Record expense; add only real-estate actions with command guards | Dashboard | Command API |
| Banking | Read-only bank evidence and WBS mock exception queue | Real bank provider unavailable | P0 | Keep candidate/exceptions/read-only proof, then connect provider via release gate | Bank transactions | Bank API, source links |
| Bank reconciliation | Local statement bridge and WBS mock evidence | Live bank statement sign-off unverified | P0 | Keep match/clear/sign-off separated and guarded | Reconcile | Banking DB, audit logs |
| Chart of accounts | Local COA and Register drills | QBO write actions excluded | P1 | Retain read-only COA, Register and GL drills | Accounting | COA API |
| Journal entry | Server/local JE workflow exists | External production deployment missing | P0 | Keep Draft/Review/Approve/Post workflow and source trace | Journal Entry | Kernel API |
| Reports | Local GL/TB/BS/IS/CF and WBS report impact | Live report E2E not integrated with backend | P0 | Generate from POSTED JE only and retain source drill | Reports, GL | Posted JE API |
| AP bills and vendors | Local AP evidence and aging | Real WBS payable receipt unavailable | P0 | Use WBS mock until signed receipt exists | Expenses | WBS adapter, AP API |
| Customers and AR | Local AR invoice/receipt evidence | Sales/payment rails excluded | P1 | Keep rent/fee receivables and receipt proof | Receivables | AR API |
| Recurring transactions | Review-only queue | No automatic recurrence posting | P1 | Evidence-driven recurring candidate review | Accounting Settings | JE template API |
| Rules | Local deterministic accounting rules | QBO rule mutation not adopted | P1 | Keep rules as audit findings and Draft JE suggestions | Rule Center, AI Audit | AI rules API |
| Attachments | Server tests and client guards exist | Provider S3/scanner release gate missing | P0 release | Require versioned object storage and scanner raw evidence | Source Documents | Attachment API |
| Audit log | Local audit plus server audit tests | Live OIDC actor evidence missing | P0 release | Bind every command to authenticated actor | Admin, AI Audit | OIDC, Kernel API |
| Close books | Local close controls | Full live close workflow missing | P0 | Keep closed-period posting blockers | Close | Period API |
| Export CSV | Mostly disabled for retained evidence | Production export policy not approved | P1 | Keep disabled unless owner approves audited export | Reports | Export policy/API |

## 6. Mock End-to-End Flow Evidence

Authoritative evidence builder: `src/wbs-e2e-flow-evidence.js`.

Ten local mock close workflows now reach a same-lineage terminal evidence state. This is **local contract-and-fixture evidence only**: it does not upgrade any WBS provider fact, receipt, key, CDC semantics, or production deployment evidence. A completed exception/control/AI-analysis flow is deliberately not treated as a posted JE; its terminal review and audit record are the required evidence instead.

| Flow | Evidence state | Missing retained evidence |
| --- | --- | --- |
| Payable Report -> AI finding -> Accrual Draft -> review | COMPLETE — posted mock JE | exact source, approval/post audit, GL and report rows |
| Bank Statement -> exception queue -> reconciliation review | COMPLETE — retained exception | controller terminal review/audit; no JE/GL/report posting is permitted |
| Cost GL -> project cost classification -> CWIP cutoff review | COMPLETE — retained cutoff review | controller terminal review/audit; no reclass is inferred or posted |
| Construction Loan Draw -> Loan JE -> GL -> reports | COMPLETE — posted mock JE | exact source, approval/post audit, GL and report rows |
| Insurance payment -> prepaid -> amortization schedule | COMPLETE — July amortization posted | 12-line schedule is retained; only explicitly reviewed July mock line posts |
| Property tax statement -> accrual or prepaid decision | COMPLETE — posted mock JE | exact source, approval/post audit, GL and report rows |
| Property Operation Data -> rent income pickup -> entity GL | COMPLETE — retained revenue mismatch | controller terminal review/audit; mismatch never auto-posts a pickup |
| Source Transactions -> Journal Entries -> Trial Balance | COMPLETE — aggregate posted trace | multi-source source/JE/GL trace and tied Trial Balance |
| Trial Balance -> BS / IS / Cash Flow | COMPLETE — aggregate posted trace | multi-source aggregate, tied Trial Balance and Balance Sheet evidence |
| Full GL -> AI Audit Center -> Accounting Analysis Report | COMPLETE — audited analysis | retained aggregate trace and analysis audit; AI cannot post |

The completion model is explicit per flow. `POSTED_JE` requires source, event, balanced Draft, controller review, standard mock post, GL/report, and audit on one lineage. `CONTROL_REVIEW` requires source/event plus controller terminal review and audit, and must retain no posted JE. `AGGREGATE_POSTED` additionally requires a multi-source, tied Trial Balance trace. `AI_ANALYSIS` requires retained GL/report aggregate evidence and an audited analysis terminal state, never a posting. A missing required item remains in `missing_evidence` and cannot be represented as complete.

## 7. MCP Readiness Checklist

Before real WBS MCP can replace the mock connector:

- Provider adapter returns the same contract collections and required fields as `WBS_MCP_CONTRACTS`.
- Every pull returns a durable immutable receipt with payload reference, storage version, response hash, tenant, entity, period, and adapter build id.
- Nonempty WBS receipt is verified before Raw -> Normalized -> Staging -> accounting event projection.
- Signed receipt hash binds to the exact response body, not a caller-provided value.
- Real provider values pass contract validation without UI-only field translation.
- Source document ids are stable and are not generated from screen labels.
- Accounting events are derived from source transaction records, not DOM text.
- Suggested JEs remain Draft until review workflow approves them.
- Closed periods, missing source documents, unbalanced JEs and duplicate source reservations fail closed.
- Posted JEs are immutable and report generation reads POSTED rows only.
- Trial Balance, Balance Sheet, Income Statement and Cash Flow are regenerated from posted JE lines.
- Audit logs include actor, source, rule, reason, confidence, action, review state and command id.
- External release still requires HTTPS/OIDC, authenticated eight-page browser E2E, provider S3/scanner lifecycle, and WBS signed nonempty receipt raw logs.

## 8. How to Verify Locally

Run these commands from the repository root:

```powershell
node verify-wbs-e2e-flow-evidence.mjs
node verify-wbs-report-impact.mjs
npm.cmd run build
git diff --check
npm.cmd test
```

Expected local result: all commands exit 0. These commands prove local mock readiness only; they do not prove production WBS, provider storage, HTTPS/OIDC, or live browser release gates.
