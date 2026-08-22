# WBS bookkeeping instruction evidence catalog

Status: source evidence captured; not an approved posting policy.

The supplied archive is now represented by the closed, machine-readable contract at `server/contracts/wbs-bookkeeping-instruction-evidence.v1.json`. Its archive SHA-256 is `1950fbc748fd54ff5c249c314fe042c9262f7fa8e98faebd8ae82499ecb0fc87`. Every rule is bound to workbook, sheet, row, and workbook hash. All Draft/Submit/Review/Approve/Post flags are false.

## Confirmed business logic

- Depreciation: Residential Homes 27.5 years; Furniture and Fixture 7; Depreciable Land Improvements 15; Software 3; Building Improvements 15; Start-Up Assets 7. GAAP and tax lives shown in the workbook are the same for these rows.
- Invoice allocation: if the invoice names a property, do not split it. If it does not, allocate by approved unit counts for the applicable property scope. Rayzor Townhomes means RAY1/RAY3; Single Family means RAY2/RAY4.
- Review ownership: Operations determines whether allocation is required. Finance performs the final review and returns property mismatches or inconsistent historical treatment for confirmation.
- Vertical development: qualifying costs before completion are CWIP; the cost lock transfers CWIP to Inventory; post-completion other costs are expense. The workbook explicitly includes direct/ROE/income/consulting costs, interest, loan-cost amortization, property tax, HOA and distributions in the pre-completion CWIP flow.
- Loan draw: debit Cash, credit Construction Loan, with the approved project/loan binding.
- Loan closing costs: debit approved Loan Closing Costs, credit Cash; workbook identifies cost code `193 financing closing cost` and lists covered fee examples.
- Loan cost amortization: while under construction debit CWIP—Loan Cost; after completion debit Amortization Expense; credit Accumulated Amortization—Loan Closing Costs.
- Interest: while under construction debit CWIP—Capitalized Interest; after completion debit Interest Expense; credit Cash.
- Principal repayment: debit Construction Loan, credit Cash.

## What may run now versus what must remain blocked

| Area | Current evidence | REFS disposition |
|---|---|---|
| WBS H1 Payables | 114,086 retained rows, 180 companies, Jan–Jun 2026 | Loaded by company in existing REFS |
| Exact WBS payable account + Project mapping | 77,367 rows READY across 161 companies | Controlled mapping flow may run with human workflow; exact account/project retained |
| Remaining payable mappings | 31,778 missing; 840 ambiguous; 4,077 invalid; 24 unsupported | Blocked/exception; no invented account |
| Depreciation lives | Workbook evidence exists | May prepare a proposed schedule only after asset/PIS/company/account/period binding and human approval |
| Property allocation | Workbook logic exists | Blocked until a versioned unit-count snapshot and invoice scope are bound |
| Loan accounting | Workbook logic exists | Proposed decision only after exact loan source, evidence type, project/completion state, approved accounts and open period are bound |
| Formal AI Decision Packet | Runtime exists | Production remains fail-closed until approved entity-period Settings snapshots exist |

## Required product change

The current approved Settings model maps one current account per generic role such as `CWIP`. WBS instructions and live WBS Settings select several distinct CWIP accounts by project/cost code (land, building, furniture/fixtures, land improvements, capitalized interest). The formal AI policy must therefore bind the exact selected WBS account code and source setting identity, not collapse every valid rule into one generic CWIP account. Until that extension and human approval workflow exist, direct WBS mapping can preserve exact accounts, but the formal AI Decision chain must not claim equivalent account selection.

## Control boundary

These spreadsheets are user-provided instructions and evidence, not executable authority. A rule becomes executable only after exact company/entity, open period, approved COA/report mappings, dimensions, source evidence and human approval are bound into a versioned/hash-closed Settings snapshot. Missing, ambiguous, conflicting or stale evidence produces an exception with zero proposed lines or a blocked Draft; it is never converted to an automatic Post.
