# Acquisition form integration

Asset detail now offers Record acquisition. Opening it fetches the scoped options
read and displays the invoice, period, cost, accounts, vendor and attachment names.
The form collects a journal number, accounting date and explanation; source IDs,
source revision, period and attachment IDs come from the API. The initial date is
the displayed source accounting date and remains editable within its period; this
does not close the outstanding authoritative accounting-date policy requirement.

Saving calls the native acquisition API. Request identity is a SHA-256 digest of
the company, asset and exact command payload, so retries with identical details,
including after a lost response, converge on the same server receipt. A synchronous
pending guard blocks double clicks. Unmount/close invalidates pending read results;
the asset workspace remounts the form on company/asset/date changes. The saved
result receives focus and opens the existing journal workflow via a fresh journal
read. The form never approves or posts a journal.

Client contract tests cover scope, payload closure, lost-response recovery,
invalid inputs and mismatched receipts. The existing fixed asset SSR suite passes.
An isolated headless browser with mocked HTTP separately exercised loading,
default source date, double-click protection, saved-result focus, Open journal
callback, 390px layout and page-error capture. That test is not live OIDC or real
PostgreSQL browser acceptance and used a minimal test stylesheet.

Remaining before acceptance: options-read review follow-ups (existing Draft
visibility, empty source text normalization, evidence-status naming), backend date
policy, authoritative browser integration with real identity/database, production
styling/keyboard/zoom coverage and deployment. Full d4 database regression has
reported older migration-roundtrip and source-hash expectation failures; preserve
and resolve those rather than treating focused green tests as full acceptance.
