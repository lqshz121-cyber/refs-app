# WBS actual-source retained evidence boundary

This contract targets the two production source surfaces confirmed by the
read-only WBS connector. It never writes WBS and never turns a read or a
signature into a Journal Entry.

## Source surfaces and current population

- `wbsdata.account_book_payable_info`: 2026H1 has 113,197 rows across 180
  companies. Amount is present and nonzero for every scanned row. Missing
  `invoice_no` (24,984) and missing vendor (1,242) are signed exceptions; they
  are not discarded or silently completed.
- `wb_insurance.insurance_data`: 2,899 policies. The production stable keys are
  `id` (primary key) and `policy_id` (unique business key). Coverage fields are
  `start_date` and `expire_date`; the fixed-point amount is
  `final_premium decimal(20,2)`.

The observed counts are discovery/control facts, not admission receipts. They
must be repeated in a fresh Provider-signed, credential-redacted package before
REFS persistence.

## Payables rules

The normalized source surface is exactly
`wbsdata.account_book_payable_info`, stable key `ap_guid`, currency USD.

- A missing invoice number yields `WBS_PAYABLE_INVOICE_NUMBER_MISSING`.
- A row with neither vendor number nor vendor name yields
  `WBS_PAYABLE_VENDOR_MISSING`.
- Every row still requires an exact clean attachment and approved mapping.
- Grouping by invoice/vendor/amount may produce a duplicate **candidate** only.
  It never confirms a duplicate, removes a row, creates a Draft, or posts.

## Insurance rules

The signed package must name `wb_insurance.insurance_data`, use strictly
ascending `id`, unique `policy_id`, an exact approved company mapping hash, and
the closed redacted column allowlist enforced by the verifier. Owner, buyer,
address, mortgage, loan number, user names, notes, and credentials are not
allowed across this boundary.

Only an exact positive `final_premium`, present `pc_code`, coverage beginning
on the first day of a month, coverage ending on the last day of a month, and
exactly 12 inclusive whole months becomes
`AMORTIZATION_COVERAGE_EVIDENCE_CANDIDATE`. Approximate 12-month ranges require
human normalization. Missing/invalid dates, nonpositive premium, or unresolved
entity mapping remain immutable Exception evidence.

The result cannot propose amortization, create a Draft, review, approve, or
post. A later authorized workflow must first persist the exact signed source,
record coverage evidence, resolve accounts/dimensions, and then invoke the
existing no-action AI proposal boundary.

## Runtime gate

Production admission requires a fresh receipt (maximum 15 minutes), exact
Ed25519 receipt/package signatures, redacted request/response bytes, exact
tenant/entity/company and mapping scope, source hashes, row/control totals, and
the signed integrations API. The public Stage1 API remains read-only while
`REFS_WBS_INGEST_MODE=DISABLED`; an unsigned pilot observation can never satisfy
this contract.
