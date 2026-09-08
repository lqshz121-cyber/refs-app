# Typed bank match source readback

Migration 322 adds versioned bank-list, reconciliation worksheet and single worksheet-item readers. They call the existing scoped readers, preserving bank pagination, admitted WBS statement membership and adjustment clearance evidence, then attach company-scoped match and Sales Receipt identities. Existing SQL readers remain available for application rollback.

The API now returns match_source_kind (SALES_RECEIPT, PAYMENT, IMPORTED_SOURCE or null), payment_occurrence_id, sales_receipt_id, sales_receipt_number, sales_receipt_revision and ledger_line_id. Source identity is explicit; null imported source never identifies a cash sale on its own. PostgreSQL numeric and bigint types remain native query columns so money and revisions retain their existing wire strings. Unmatched bank history retains the original receipt; a worksheet without an active match returns null source fields.

Down migration removes only the new read functions. It does not alter matches, receipts, source links or ledger rows. Roll back the application reader calls alongside a database rollback, or forward-fix the read layer. Existing migration 320 continues to refuse destructive removal of retained cash-sale match history.

PostgreSQL acceptance additions read an actual created, posted and matched cash sale through the bank API and both worksheet repository paths; assert exact money and IDs; verify denied reads; execute down/up with retained history; and read history after the existing unmatch command. These additions require remote execution because local Docker is unavailable. This verifies readback, not the complete unmatch command contract or sign-off concurrency.

The browser parser and cash-sale matching UI still require their own typed source integration, followed by real browser/identity acceptance, performance evidence and independent audit. This is not a deployment or a completed end-user feature.
