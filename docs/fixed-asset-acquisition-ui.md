# Acquisition form integration

The V2 form now lists up to 20 existing unposted acquisition journals with their
current status/date and passes the exact journal ID and period to the resume
callback. A new Draft form is hidden when existing journals are present until the
user explicitly chooses Create another draft. Resume remains visible even when
new acquisition creation is blocked. The form also displays placed-in-service date
separately from accounting date. Truncation is identified with a Journals notice.

The integrated client/asset SSR suite passes. A separate owned mocked HTTP browser
run additionally verified an Approved existing journal resumes with its exact period
without a POST, the explicit new-Draft choice, and the original save/focus/double
click checks (10 checks total). This still does not replace real database/OIDC
browser acceptance. The cross-period app/workflow bridge is a separate pending
integration; these component-level callback assertions alone do not prove it.

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
