# Native payment and receipt Drafts

The native endpoints accept a number, payment date/period, exact decimal amount,
active BANK-controlled GL account and BANK member, reason, and 1–25 verified
clean attachment IDs:

- `POST /entities/{entityId}/ap/bills/{businessDocumentId}/native-payments`
- `POST /entities/{entityId}/ar/invoices/{businessDocumentId}/native-receipts`

These are new evidence-backed commands. Existing AUTO settlement endpoints keep
their source-trace requirements. The native command creates a new MANUAL Draft
with JE_ATTACHMENT links, a payment occurrence and a PENDING allocation in one
PostgreSQL transaction. It neither converts existing journals nor invents WBS
source receipts. Existing separate Submit/Review/Approve/Post controls and AP/AR
reducers apply to the new journal.

The server requires the source document's scoped POSTED journal lineage. An older
source can be settled in a later OPEN payment period. Period and source row locks
plus PENDING allocation locks protect available capacity; ACTIVE allocations
have already reduced open balance. The selected bank account and member must
remain active and correctly typed. Verified attachments are scope-checked and
locked during creation. All audit/outbox/receipt/evidence/business changes commit
or roll back together.

Idempotency uses a separate native operation scope and binds the authenticated
actor, complete input and sorted attachment identities in a server-derived hash.
Reusing a key with changed input fails. Another actor cannot replay the receipt.
A successful replay returns the retained Draft creation receipt even after the
linked journal progresses; read the current register before opening its workflow.
The command does not transmit a bank payment or automatically post a journal.

Optional AP_PAYMENT_ENTRY_MAKER and AR_RECEIPT_ENTRY_MAKER bundles add attachment
upload authority to their respective creation authority and existing reads. They
do not grant lifecycle approvals. Defining a bundle does not assign it to anyone.

Integration runs the same AP/AR capacity scenario for both legacy and native
commands. Only the legacy variant needs the isolated AUTO source fixture; the
native variant must post from its actual attachment links. Native checks include
missing/foreign evidence, exact decimal transport, malformed command receipts,
scope isolation, inactive/wrong bank members, replay/input conflict, partial
Post and concurrent capacity enforcement. Real browser/OIDC and deployed user
acceptance are separate outstanding gates.
