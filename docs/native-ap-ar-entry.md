# Native bill and invoice draft entry

The authoritative Payables and Receivables workspaces expose entry only for an
open scoped period and a current actor with the specific `AP.BILL.CREATE` or
`AR.INVOICE.CREATE` permission plus `ATTACHMENT.CREATE`. The optional entry
role templates provide these capabilities; this UI grants no permissions.

The maker selects an active vendor (AP) or customer/affiliate (AR) from the
authenticated counterparty search. Search is literal and paginated by the
server's reference cursor. Category choices come from the scoped chart of
accounts and exclude inactive accounts and accounts requiring a member.
Current commands support one category amount, with up to four decimal places.
Amounts remain decimal strings through the HTTP request.

Supporting PDF, PNG, JPEG or CSV files must pass the existing server upload,
object-version and malware-verification flow. Before upload and creation the
client rereads actor access and period status; creation also rereads the chart
of accounts. The server remains responsible for permission, master-data and
posting invariants under its transaction.

Upload intent keys hash the company, current actor, canonical file metadata
and content hash. Document intent keys hash company, period, kind, actor and
validated document contents. These identify retries; they do not replace the
server's request hash or idempotency receipts. Retrying unchanged details after
refresh produces the same key. A verified retained attachment is reused without
another object PUT. Changed document details represent another intent.
If the server explicitly reports a closed upload, a separate user click starts
a new numbered upload attempt. Each attempt has a stable key; unknown failures
keep the same attempt. After refresh, traversing the same closed attempts
recovers the later attempt. No replacement upload starts automatically.

An unknown command outcome freezes form edits and offers an explicit retry of
the same draft. Known HTTP 4xx rejections allow correcting an initially rejected
request; a prior unknown outcome remains frozen. There is no automatic retry.
The form warns on browser unload while an outcome is unknown. This is a local
interaction safeguard, not a persistent financial record: after navigation or
refresh, the maker must check saved drafts and use unchanged details to recover
an unknown request before starting another document.

A verified creation receipt enables opening the existing Draft journal
workflow. The application rereads the scoped journal register before opening
that Draft. Closing a confirmed entry refreshes the document list. Creation
does not submit, review, approve or post. Local form state and receipt display
never supply ledger or financial balances.

Dependencies: the native command receipt contract, migration 302 counterparty
reader and migration 303 attachment-reservation recovery. Browser production
acceptance still requires the exact deployed API/Web SHA, a real OIDC maker,
separate workflow actors, clean support, refresh persistence, unknown-response
recovery, scope switching during in-flight work, keyboard/focus/resize and
console/network evidence. Unit/SSR checks are not that live acceptance. Full
line items, tax, PO/receipt matching and payment entry are outside this increment.
