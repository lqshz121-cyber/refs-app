# Claude Task: QuickBooks Bank and Reconciliation parity review

**Priority:** HIGH  
**Category:** QuickBooks behavior / Frontend  
**Base:** `1233a133721513c6b04df79d2cb196109c8778db`  
**Branch:** `claude/qb-bank-reconcile-review-20260805`

## Scope

Perform a read-only comparison of the available QuickBooks Banking/Reconcile surfaces with REFS authoritative Bank Transactions and Reconciliation workspaces. Implement only evidence-safe improvements: account/entity/date filters, queue states, book/bank/difference summary, full-page evidence detail, and exact Back-state restoration.

## Boundaries

- Do not activate QuickBooks or REFS mutation actions.
- Exclude bank feeds/connect/import/OCR, match/categorize/clear/sign-off/adjust/post, payments/refunds, export/share/sync, and promotions.
- Pending/Posted/Excluded and matched/cleared/signed-off are independent states.
- Production UI must use authoritative API/OIDC data and show loading, empty, blocked, and retryable error states. Seed/mock data is never authoritative.

## Acceptance

- Controller and read-only role visibility is explicit.
- Deep link -> detail -> JE/GL/Reconcile -> Back restores account, queue, query, dates, type, page, and selection.
- No ambiguous Fix/Apply/Accept labels.
- Focused UI/API tests, visual tests, build, English gate, and `git diff --check` exit 0.
- Return SHA/base, files, tests+exit, read-only QBO evidence observed, exclusions, remaining risks, and no-equivalence claim.
