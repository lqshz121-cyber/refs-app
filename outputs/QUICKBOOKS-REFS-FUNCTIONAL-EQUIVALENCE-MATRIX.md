# QuickBooks Online → REFS Functional Equivalence Matrix

This branch matrix records only directly observed QBO evidence and verified authoritative REFS behavior. It does not replace historical matrices and does not mark unobserved behavior as equivalent.

## Evidence log — 2026-08-19

| Surface | Newly observed QBO evidence | REFS change | Verification | Status |
|---|---|---|---|---|
| Expenses navigation | Opening **Expenses** in the QBO main navigation expands `Expense transactions`, `Vendors`, `Bills`, `Bill payments`, `Contractors`, and `1099s`. Selecting `Expense transactions` navigates to the Expenses page. | Existing REFS primary navigation continues to open its first applicable child per the user's product rule. No QBO-only contractor, 1099, payment-provider, or external workflow was added. | Read-only QBO DOM inspection; no create, edit, payment, export, settings, or data action. | PARTIAL — structure observed; REFS intentionally follows the user's first-child rule. |
| Expenses page hierarchy | At a 525×599 viewport, QBO shows a 24px/500 `Expenses` heading, compact 36px transaction control, Filter, date scope, and one empty state. Body typography is 14px Avenir/Helvetica with `#f4f5f8` background. | AP heading is now compact rather than a decorative hero. The duplicate four-card KPI summary and repeated empty adjustment panel are removed from Expenses only. Filters, Bills, Vendor credits, AP Aging, drill/Back, pagination, READ ONLY state, and folded WBS evidence remain available. | `npm run test:authoritative-documents` exit 0; `npm run test:authoritative-full-shell` exit 0; `npm run test:authoritative-visual-parity` exit 0; `npm run build` exit 0; `npm test` exit 0 (visual verifier 64/64). | CANDIDATE — observed shell and local contract only. |
| Expenses empty state | QBO text: `No expenses found` and `Try to change some filters to see more results.` | REFS renders one `No expenses found` state with concise filter guidance plus the required fail-closed note that a scoped API result is not evidence of zero activity. | Focused SSR and full regression contracts exit 0. | CANDIDATE — no populated QBO expense rows observed. |
| Reports Favorites | QBO Standard reports shows compact Favorites rows, including AR aging, Balance Sheet, and Profit and Loss; rows are about 41px high. | Prior branch commits compacted Favorites, moved AR Aging into the same list, folded Statement Snapshot, and capped directory preview at 12 rows while retaining full-report access. | `npm test` exit 0; visual verifier 64/64; `npm run build` exit 0 at `de617d7`. | PARTIAL — authenticated Render runtime not verified. |

## Explicit unverified gaps

- QBO populated Expenses table columns, row selection, detail drill, permissions, audit history, vendor/bill/payment linkage, and non-empty responsive behavior were not observed in this round.
- QBO Print Checks, New transaction, QuickBooks Payments promotion, Export to Excel, Print, settings, external connections, contractor/1099 workflows, payment initiation, and mutation behavior are excluded and were not exercised.
- Authoritative Render/OIDC/PostgreSQL runtime behavior was not tested in this local UI branch. Passing SSR/build tests does not establish production or QBO equivalence.
- AR remains unchanged because its comparable QBO page was not audited in this round.
