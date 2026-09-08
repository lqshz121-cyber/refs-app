# Counterparty maintenance UI

Vendor and customer registers now open a current master detail form, a new-contact form, and a paged change history/review panel. The fields currently supported by the master are reference, display name and active status. Contact/tax details and ledger-derived balances are still separate outstanding work.

The browser quietly reads current authenticated access. Makers can propose changes, and a different approver can approve or reject pending requests. A proposal does not immediately change the register. Existing master edits carry the exact revision returned by the detail API. Both the HTTP boundary and PostgreSQL independently validate the command; browser state grants no authority.

Pending commands are scoped by API base, tenant, entity and authenticated actor. Before sending, the browser retains the closed command and stable idempotency key in session storage. Lost or malformed responses keep that command locked for exact retry; a recovered command cannot be overwritten by a new intent. Current access and actor are checked again before every POST. Access tokens are never retained with a pending request. Successful receipts clear the retained request. If browser storage cannot retain a request, the UI reports the failure before sending it.

Local headless Chrome fixtures cover desktop and 390-pixel mobile layouts: create, response lost after commit, remount recovery, same-key replay, approval, exact-version edit, deactivation, history, focus, viewport fit and absence of client actor/tenant fields in command bodies. The original directory fixture still covers paging, filters and stale cross-company response disposal. Fixtures use intercepted mock HTTP and do not prove live IdP, deployed persistence, or business acceptance.

The SQL/API combination passed two selected maintenance scenarios in fresh PostgreSQL 15 and 16 after correcting the rollback test to restore later read migrations. Complete UI root/server/build gates, broader database concurrency/performance, final integration with 328/329, independent review and deployed acceptance remain required before release completion.
