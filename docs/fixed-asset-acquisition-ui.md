# Acquisition form integration

Keyboard focus moves to Journal number when Create another draft replaces its
button, and to the stable panel heading when retry/refresh enters loading. A
checked-in isolated browser test exercises those DOM transitions, an Approved
pending journal callback, and save/retry interaction: run
`npm run test:asset-acquisition-browser` with Playwright available, or set
`REFS_PLAYWRIGHT_MODULE` to its module URL. Optional `REFS_ASSET_BROWSER_OUTPUT`
must name a new directory; otherwise the test creates a temporary directory.
This test uses mocked HTTP and minimal CSS, not production database/OIDC acceptance.

The form displays Source accounting date separately from Placed in service and
the editable Accounting date. Current database behavior permits a maker-selected
journal date inside the reviewed source's OPEN period and retains the explanation.
It also validates that the source accounting date belongs to that period. The
service date drives the separate depreciation policy. These dates need not be
equal; enforcing equality would be a separate policy change, not a UI default.

The actual asset handoff callback is additionally executed in targeted tests for
all four resumable states, period mismatch, late company change, invalidated read,
missing scope, failed read and a journal already Posted. Those tests isolate its
dependencies and do not stand in for a full application browser acceptance run.

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
browser acceptance. The integrated asset-specific bridge resolves the journal's
period in the current company scope catalog, reads the journal in that period,
then applies the same period to the subsequent workflow. Stale company changes
invalidate the result. It accepts all four unposted workflow states; component
callback and pure policy assertions alone do not prove full browser integration.

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

Remaining before acceptance: backend date policy, authoritative browser integration
with real identity/database, production styling/keyboard/zoom coverage and deployment.
Migration 351 addresses the options-read review follow-ups. The two d4 full-regression
failures were corrected with passing focused tests; the failed log remains evidence
and the integrated candidate still requires its complete regression gates.
