# Native settlement input reads

Migration 304 adds two authenticated, entity-scoped reads for AP payment and
AR receipt makers. It changes no command, role assignment or posting authority.

`GET /entities/{entityId}/settlements/draft-bank-members` takes `kind`
(`AP_PAYMENT` or `AR_RECEIPT`), optional literal `query`, `afterRef`, and `limit`
(1–100, default 50). Only active BANK master rows are returned. References use
UTF-8 C keyset order and `next_ref` is the last visible reference when another
match exists. Search uses literal substrings, including `%` and `_`. Restart
paging when changing the search. Pages reflect current master data, not a frozen
financial population. The existing active-master index from 302 is reused.

Bank GL choices come separately from active COA rows requiring BANK members.
There is no general bank-to-GL relationship table in this schema, so this reader
does not invent one or infer cash accounts from names or account-code prefixes.

`GET /entities/{entityId}/business-documents/{businessDocumentId}/settlement-context`
takes `kind` and the intended payment `periodId`. One database snapshot returns
source identity, currency, status, revision, open balance, payment-period bounds,
PENDING allocation total and available amount. The source can be from an older,
closed period. A closed payment period is visible but ineligible. Wrong kind,
missing document or missing scoped payment period returns 404.

Available amount equals open balance minus all PENDING allocations against the
document (including pending credits). ACTIVE allocations already reduced the
open balance and must not be deducted again. Decimal strings retain four places;
the HTTP validator checks their identity with integer arithmetic. Negative
capacity is preserved and ineligible instead of being clamped to zero.

`can_create_draft` is advisory: positive capacity, OPEN payment period and the
existing command's source-status rules (AP APPROVED/OPEN/PARTIALLY_PAID; AR
OPEN/PARTIALLY_PAID). It does not certify the selected bank, payment date, complete
evidence or future command success. Commands still lock and reread period,
document, pending allocations and masters. Reads hold no lock during form entry.

Both endpoints require AP.PAYMENT.CREATE or AR.RECEIPT.CREATE according to kind,
reject bodies, command headers and unknown/duplicate query parameters, and
return `Cache-Control: no-store`. Database functions explicitly revoke PUBLIC
execution. No tenant or actor comes from query or body input.

Verification covers HTTP contracts, decimal precision, wrong scopes, maker
permissions, inactive/type-mismatched masters, literal keyset searches over
100001 rows, migration down/up and durable AP/AR source and settlement flows.
Post-reducer integration uses the existing isolated admitted AUTO source fixture;
it does not prove a native payment evidence workflow exists. Payment/receipt
Drafts currently use AUTO journals and need their own valid source/evidence path
before production Post. The future native form must address that path, explicit
bank selection and stable retries. Real identity/browser and independent audit
acceptance remain outstanding.
