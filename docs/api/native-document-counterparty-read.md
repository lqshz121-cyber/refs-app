# Native Bill and Invoice counterparty choices

`GET /api/v1/entities/{entityId}/business-documents/draft-counterparties`
reads actual `member_master` rows for native document entry. It requires
`AP.BILL.CREATE` for `kind=AP_BILL` and `AR.INVOICE.CREATE` for
`kind=AR_INVOICE`. Authentication supplies the tenant and actor; the route
supplies the entity. It neither grants access nor creates accounting records.

The optional `AP_BILL_ENTRY_MAKER` and `AR_INVOICE_ENTRY_MAKER` human role
templates combine the existing read permissions, the corresponding create
permission and `ATTACHMENT.CREATE` for supporting evidence. They do not permit
attachment finalization/scanning, submission, review, approval or posting.
Existing WBS and Invoice maker bundles remain unchanged. Deploying the code
does not assign either new role; any actual assignment uses the existing
explicit, expiring, version-checked IAM procedure.

Bills return active `VENDOR` members. Invoices return active `CUSTOMER` and
`AFFILIATE` members. The response returns the stable member reference, member
type and current display name. This endpoint is a document-entry lookup; it
does not implement vendor/customer maintenance, contact/tax details, balances
or the complete native master object lifecycle.

`query` is optional, trimmed, at most 128 characters, and searches reference
and display name case-insensitively. `%` and `_` are literal characters.
`limit` defaults to 50 and must be 1–100. A non-null `next_ref` means another
matching row existed in the same query snapshot. Request the next page with
that value as `afterRef`, preserving kind and query. Ordering uses UTF-8 `C`
collation and an index on active scoped references. There is no offset scan.

Each request observes current master data. Pagination is not a retained
financial population snapshot. Reset paging and selected choices when the
company, document kind or query changes. A stored selection is never evidence
that a member remains active: the existing create command and journal-line
master guard independently revalidate it in the accounting transaction.

Responses use `Cache-Control: no-store`. Unknown/repeated query parameters,
request bodies, command headers and invalid limits/cursors are rejected.
The HTTP layer checks the returned entity, kind, query, cursor, order, member
types and page structure before returning any choices.

Migration 302 adds a scoped read function and active-reference index. The down
migration removes only these artifacts, preserving all master and business
records. The PostgreSQL gate exercises down/up, permission and scope denial,
inactive filtering, literal search, page boundaries and a keyset lookup after
inserting 100,001 synthetic master rows. Unit/HTTP tests are included in the
normal server gate. Actual production UI and live acceptance remain separate.
