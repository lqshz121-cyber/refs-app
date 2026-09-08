# Counterparty register implementation

The vendor navigation currently has no authoritative register endpoint. The existing migration 302 picker requires document-creation permission and supplies only active counterparties for a Draft form; it cannot serve as the general register.

Migration 326 adds a company-scoped master-data read using AP.VIEW for vendors and AR.VIEW for customers, including inactive rows when selected. The cursor uses immutable member references with C collation. Search treats percent and underscore literally. Rollback removes only the function and index and retains member data. The existing maker picker remains independently permissioned.

The GET `/api/v1/entities/{entityId}/counterparties` route derives the tenant from the authenticated principal, validates query fields and returned scope/status/cursor evidence, and delegates to the session-bound database function. It returns no-store responses. OpenAPI describes the current master-data page; the register is distinct from the maker-only Draft picker.

This is an implementation step, not delivery of the vendor/customer workflow. The actual register page, detail trace, contact/tax metadata, revisioned create/update/deactivate commands with idempotency and audit, and ledger-backed per-currency balances remain outstanding. Customer affiliation must stay explicit rather than silently treating affiliates as customers. Master records do not themselves create accounting entries; their invoices, bills and settlements must retain the normal Draft-to-Posted accounting lifecycle.

Initial PostgreSQL 16 validation passed one isolated scenario without skips, covering active/inactive paging, literal search, module permission denial, cross-company denial and data preservation through down/up. Three API tests passed and are included in the default runtime contract suite. The expanded real HTTP-to-PostgreSQL scenario is running on PostgreSQL 15 and 16. Full regression, same-tenant cross-entity coverage, 100,001-row performance, mutation concurrency and end-to-end business acceptance remain required. No production grants or real master data have been changed.
