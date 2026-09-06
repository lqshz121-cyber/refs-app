# Sales Receipt reads

`GET /api/v1/entities/{entityId}/ar/sales-receipts?periodId=…&afterId=…&limit=50` returns one company and period. The default is 50 records; the maximum is 100. Records are ordered by stable receipt UUID, not receipt number or posting date. `next_id` is the final visible identity only when another row exists. The client must return to the first page when the company or period changes. Pagination is a current-state read, not a historical snapshot: concurrent inserts with identities behind an existing cursor appear after refresh.

`GET /api/v1/entities/{entityId}/ar/sales-receipts/{receiptId}` reads one persisted record by stable identity. Both endpoints require server-derived identity and `AR.VIEW`. Raw application access to the underlying table and read view remains revoked. A receipt outside the authorized company is not returned. Read bodies and command headers are rejected; responses use `Cache-Control: no-store`.

Migration 318 adds a private view joining the receipt to its real journal and a `(tenant_id, entity_id, period_id, sales_receipt_id)` index. Its down migration removes only the read functions, view and index, preserving business records. Security-definer functions enforce company scope before reading.

| Fields | Meaning |
| --- | --- |
| `sales_receipt_id`, `period_id`, `receipt_number` | Persisted receipt identity, period and number |
| `customer_ref`, `customer_name` | Customer identity and name retained at creation |
| `bank_member_ref`, `cash_account_code`, `category_account_code` | Saved cash and category coding |
| `accounting_date`, `currency`, `amount` | Accounting date, currency and exact four-decimal string |
| `description`, `status`, `revision` | Saved description, Draft/Posted state and decimal-string revision |
| `journal_entry_id`, `journal_number`, `journal_status`, `journal_revision` | Actual linked journal and current approval state |
| `created_at`, `posted_at` | UTC timestamps with six fractional digits; posting timestamp is null until Posted |

Response validators reject wrong scope, repeated or unordered page identities, mismatched periods, lossy numeric amounts, inconsistent receipt/journal states and malformed revisions. No invoice, AR open balance or payment allocation is invented to represent the cash sale.

Tests include simulated-kernel API boundaries and a PostgreSQL scenario that creates a receipt through the real API before reading it. The database scenario adds 100001 synthetic persisted receipt/journal pairs solely for pagination performance, validates the beginning and end of pagination and direct reread within five seconds, and checks scope, permissions and down/up preservation. Synthetic performance rows are not evidence of posting correctness. PostgreSQL execution for migration 318 is still pending; local Docker is unavailable. Native UI, input selectors, recovery, bank matching, refund/cancellation and live business acceptance remain outstanding.
