# Document settlement history

GET /api/v1/entities/{entityId}/business-documents/{businessDocumentId}/settlements?kind=AP_PAYMENT|AR_RECEIPT&limit=50&afterId=<optional occurrence UUID>

Requires company READ access. Returns payments or receipts for one source document across payment periods, ordered by immutable creation time and UUID descending. Each record retains amount/currency, occurrence state/revision, payment-period identity and linked journal number/state/revision. The cursor is resolved only inside the exact company, document and kind; a foreign or nonexistent cursor is rejected. Read bodies, command headers and unknown query fields are rejected.

The last visible occurrence is the next-page cursor when another row exists. A later insertion appears after refreshing the first page. Status changes are current database facts, not a multi-page immutable snapshot. Amounts and revisions remain strings; the response is no-store. History grants no accounting actions.

Migration 306 provides the scoped keyset index and STABLE SECURITY DEFINER read function, with PUBLIC revoked and a down migration. HTTP contracts reject mismatched scope, order, duplicate records and malformed amounts/journal facts. PostgreSQL integration scenarios exercise both AP/AR and legacy/native creation, a later payment period, posting, partial reservations and two-page reads without business-state mutation. Full fresh/restore and performance/down-up verification must pass before release. No UI or production acceptance is claimed by this API change.
