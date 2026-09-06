# Native bill and invoice request recovery

Preparing a document validates the current company, open period, category, counterparty, support and actor. It returns a command containing the exact decimal body and idempotency key, scoped to API base URL, entity, period, kind and actor. The key includes the API base URL.

The form retains that command before transmission. Navigation within the same page session restores its fields, counterparty and verified attachment without uploading again. Unknown outcomes keep the inputs and close action locked. A later access refusal cannot discard an earlier uncertain request. A confirmed result clears the retained command even if the original form has unmounted.

Replay checks the original actor and current create permissions and sends the original body/key. It does not repeat open-period or category preparation, which could prevent retrieving an already committed receipt. The database still decides whether a new write is allowed. A closed-period entry exposes only Resume pending when a matching retained request exists; it does not allow starting a new draft.

Recovery is in memory for this page session. It is not browser-restart, reload or cross-deployment persistence. It stores no tokens and is not accounting authority. Upload interrupted before command preparation is outside this command recovery scope.

Regression coverage includes AP/AR command isolation and replay, closed-period entry gating, and a PostgreSQL lifecycle test that returns the original saved receipt after soft close while rejecting a new document and preserving document/ledger/audit counts. Actual-component browser scenarios use simulated APIs and cover held POST, navigation, original inputs, permission refusal, closed period, identical body/key/attachment, saved-draft callback and refresh focus. Those browser tests are not live business acceptance.
