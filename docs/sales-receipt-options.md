# Sales Receipt input choices

`GET /api/v1/entities/{entityId}/ar/sales-receipt-options` accepts `optionKind`, optional `query`, `afterRef` and `limit` (default 50, maximum 100). It requires `AR.SALES_RECEIPT.CREATE`, so an authorized maker can choose the masters needed by the same create command without receiving unrelated view permissions.

| Option kind | Eligible active company master |
| --- | --- |
| `CUSTOMER` | CUSTOMER or AFFILIATE members |
| `BANK` | BANK members |
| `CASH_ACCOUNT` | Accounts requiring a BANK member |
| `CATEGORY_ACCOUNT` | Accounts that do not require a member |

The category filter expresses the current command's eligibility rule; it does not infer a revenue classification absent from the account master schema. Selection does not lock or reserve a master. Creation revalidates active status, company and account/member requirements in its transaction.

Each row has `ref`, `label`, `kind`. The envelope carries schema version `SALES_RECEIPT_OPTIONS_V1`, company, requested kind, search, cursor, limit, rows and `next_ref`. Search is a literal case-insensitive substring of reference or label, not SQL wildcard syntax. References are paged in PostgreSQL C collation; runtime validation uses matching UTF-8 byte ordering. Change company, kind or search by starting at the first page. Results are current state rather than a historical snapshot.

Migration 319 installs the scoped read function and an active-account reference index; it reuses the existing active-member reference index. Rollback removes only its function and index. SQL arguments are parameterized; company and tenant derive from the authenticated request. No direct master-table grants are added. Responses use `Cache-Control: no-store` and reject command bodies/headers and mismatched result scope or pagination.

Contract tests cover all four options, affiliate results, input rejection, wrong scope/kind/order/cursor, unimplemented reads and denied permission. The PostgreSQL scenario checks active same-company filters, literal percent search, maker-versus-reader permissions, 100001 synthetic customer and category rows with bounded first/tail reads within five seconds, and down/up preservation. Its real PostgreSQL execution is still pending. Native form, navigation recovery, bank matching and live business acceptance remain incomplete.
