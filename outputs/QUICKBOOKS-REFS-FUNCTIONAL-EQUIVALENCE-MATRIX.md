# QuickBooks → REFS Functional Equivalence Matrix

## Reports Center — read-only catalog boundary (2026-08-05)

| Capability | QBO evidence | REFS implementation | Status |
|---|---|---|---|
| Core report launch and return | Existing QBO-style Reports shell evidence; favorites/menu actions are out of business scope. | Core financial catalog and search retain TB, GL, BS, IS, CF and scoped control report launches with full-page Back. | PARTIAL — local contract verified; QBO permissions and report personalization remain unobserved. |
| Favorites and report menus | Favorites, Add to favorites and More Options would persist or manage a report view. | These controls and storage are removed; the table states `Unavailable`. No customize/share/export/report-management action is exposed. | PARTIAL — business-fit read-only boundary, not QBO equivalence. |

- Verification: `node verify-reports-readonly-catalog.mjs` and `git diff --check`; integration build/visual required before release.

## Accounting — COA/Register retained evidence query (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| COA list and Register scope | Read-only QBO Chart of accounts showed name/number filter, account-type and QuickBooks/Bank balance columns, plus pagination. New account, batch edit, export and print were visible but not operated. | COA retains its local name/number query when opening a permitted cash Register. Register now carries its local posted-evidence query with entity, account and period through JE/GL/Reconcile returns and explains a scoped empty search result. | PARTIAL — local return contract verified; QBO populated Register, role behavior and page/scroll behavior remain unobserved. |
| Cash-only reconciliation | QBO account actions were not operated. | Only a same-entity mapped cash Register exposes Reconcile. Non-cash COA accounts remain GL-only with no Bank/Reconcile drill. | PARTIAL — local safety boundary, not QBO equivalence. |

- Assistant3 scope review applied. Required verification: `node verify-coa-register-return-query.mjs`, `node build.mjs`, visual verification and `git diff --check`.

## Banking — retained queue scope through evidence drills (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Banking queue surface | Read-only QBO Banking page showed account cards, Pending/Posted/Excluded queues, Search, date and transaction-type filters, and columns for Date, Bank description, Spent, Received, attachment, From/To and Match/Categorize. Link/Update/Print/Export controls were visible but not operated. | Bank Transactions retains local account, Pending/Posted/Excluded queue, query, date range, transaction type and page only; action controls open read-only evidence rather than a banking mutation. | PARTIAL — QBO screen observed read-only; detailed permissions, populated row behavior and responsive layout remain unverified. |
| Queue → detail → JE/GL/Reconcile → Back | QBO row detail and Match/Categorize actions were not operated. | A retained Bank item now carries its originating queue/query/date/type/page through JE, GL Detail, Trial Balance, signed-history and Reconcile links. Returning to the Bank evidence rehydrates that scope instead of clearing it to a default queue. | PARTIAL — local contract verified; QBO deep drill and audit behavior remain unobserved. |
| Read-only boundary | QBO Link/Update/Print/Export and Match/Categorize were intentionally not operated. | No feed/connect/import/OCR, auto-match/categorize/clear/sign-off/post, payment, export or account mutation is enabled. Matched, cleared and signed-off remain independent retained evidence states. | PARTIAL — business-fit local boundary, not QBO equivalence. |

- Assistant3 Banking/Reconcile business-fit review applied. Required verification: `node verify-bank-evidence-return-scope.mjs`, existing Bank return/lifecycle contracts, `node build.mjs`, visual verification and `git diff --check`.

## Expenses — Bills evidence queues and retained return scope (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bills review queues | QBO Bills labels observed read-only: For review, Unpaid, Paid and Recurring, with Filters and Bill Date. Pay bills, Add bill, Print, Export and Customize were visible but not operated. | Bills shows only evidence-proven For review, Unpaid and Paid tabs. Recurring is explicitly reference-only/unavailable. Unpaid requires a retained posted AP source; Paid requires retained posted payment evidence. | PARTIAL — local queue rules verified; QBO membership, permissions and populated-state behavior remain unobserved. |
| Full-page Bill evidence return | QBO Bill detail interactions were not operated. | List → Bill replaces the list with a full-page evidence view. Bill → JE/source carries tab, Bill Date/date range, vendor, query and local filters; Back rehydrates the originating Bills scope. Payment remains a nested full-page detail that returns to the Bill before the queue. | PARTIAL — local return contract verified; QBO deep-drill, audit and responsive behavior remain unobserved. |
| Read-only boundary | QBO mutations were intentionally not operated. | Pay bills, Add bill, Print, Export, Customize and local approve/post actions are not rendered or enabled in this workflow. | PARTIAL — business-fit local boundary, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. Required verification: `node verify-bills-evidence-queue-scope.mjs`, `node build.mjs`, visual verification and `git diff --check`.

## Accounting — AP Aging control evidence → Source retained return (2026-08-04)

## P0 operator navigation and report replacement (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Single-destination navigation | User-provided REFS screenshots showed Journal Entry and Reports expanding despite one child. | The parent click routes directly to its sole destination and suppresses the duplicate child row. | PARTIAL - local runtime contract verified; browser bridge exposes no tab for screenshot verification. |
| Report drill detail | User-required behavior: a clicked report amount must open a separate detail view with an explicit return. | GL/TB/financial-statement drill rendering is a replacement view with `Back to [Report]`; no detail panel is rendered below the statement. Scope retains entity, period/as-of, dimensions, account/control account, cash/loan/related-party context and POSTED-only evidence. | PARTIAL - local contract verified; QBO populated report drill behavior remains unobserved. |
| English-only UI | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the QBO homepage. | An English-only visible-text gate prevents legacy Chinese/mojibake source labels from rendering in the operator UI. | PARTIAL - source/build verification passed; browser screenshot remains unavailable. |

- Assistant3 business-fit review: retain only same-scope local POSTED evidence and real-estate dimensions; exclude external connections, bank feeds, imports, email/print/export/share, Spreadsheet Sync, automatic matching/adjustment/posting, QBO mutations, Sales/KPI/payment channels.

## Accounting: Bank transaction evidence decision (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bank transaction decision detail | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the QBO homepage. Assistant3 business-fit review identified the missing decision explanation. | Each Bank Transaction now opens a full-page evidence detail with Bank ID/date/direction/amount/description, entity/account/cash scope, property/project/loan, candidate or linked source, source completeness, lifecycle, reason code and a read-only decision explanation. Back retains the original queue, account, filters and page context. | PARTIAL - local source/build and existing Bank return contracts verified; QBO queue detail, permissions, audit and responsive behavior remain unobserved. |
| Evidence-only Bank boundary | Assistant3 scope excludes bank feed/import/OCR, auto-match/categorize/clear/post, online payment/refund, external connectors/sync/export and Sales/payment channels. | Row and batch actions now open evidence detail only. Categorization, matching, excluding/restoring and posting are not exposed from the retained-evidence Bank shell; unresolved items remain Review with explicit cause. | PARTIAL - business-fit local control, not QBO equivalence. |

- Verification: `node verify-bank-evidence-decision.mjs`, existing Bank transaction evidence/return/pagination/lifecycle gates, reconciliation return, English gate, build, and `git diff --check`. Retained bank-account masters now carry the local GL/cash-scope mapping required for exact POSTED cash-JE proof. `verify-bank-transaction-focus.mjs` is not present in this worktree; its absence is recorded rather than treated as a passing check. Browser bridge evidence remains unavailable for this cycle.

## Accounting: Reconcile statement-level bridge (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Statement-level reconciliation bridge | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the QBO homepage. Assistant3 business-fit review identified the required Book/Bank/Difference bridge. | Reconcile displays entity, one bank account, cash scope, statement dates, book balance, retained adjustments, cleared/uncleared movement, adjusted book/bank and difference. Each retained bank item drills to a full-page Bank detail and Back restores the reconciliation statement scope. | PARTIAL - local source/history/build contracts verified; QBO worksheet fields, permissions, audit and responsive behavior remain unobserved. |
| Evidence-only reconciliation boundary | Assistant3 scope requires POSTED cash JE/Bill/Receipt evidence, explicit match/cleared/signed-off/reopen states, and Review for non-zero difference, reopened statement, missing/cross-entity dimensions or unproven bank evidence. | Reconcile no longer offers categorization/posting, suspense posting, or sign-off from this retained-evidence workflow. Match does not imply cleared or signed-off; no bank feed/import/OCR, auto-match/adjust/clear/post, payment/refund, external sharing/export, Sales or sync action is enabled. | PARTIAL - business-fit local control, not QBO equivalence. |

- Verification: `node verify-reconciliation-statement-bridge.mjs`, reconciliation history/detail-return gates, report replacement, English gate, build, and `git diff --check`. Browser bridge evidence remains unavailable for this cycle.

## Expenses: Bill AP balance explanation (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bill balance explanation | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the QBO homepage. Assistant3 business-fit review identified the missing operator explanation. | Bill Detail displays the selected as-of date and `Original bill − effective POSTED payments − applied vendor credits = open AP`, plus entity/vendor, property/project, source, Bank/Reconcile, credit-link and explicit Review evidence. | PARTIAL - local unit/build verified; QBO Bill balance allocation, permissions, audit and responsive behavior remain unobserved. |
| Read-only evidence boundary | Assistant3 scope: no posted payment, unapplied/over-applied credit, later payment, cross-entity/dimension conflict, void/reversal timing and missing Bank evidence must remain Review/empty. | Any unproven reduction is kept out of the displayed effective payment/credit amount and surfaced as Review. No Bill Pay, external bank/supplier/OCR, online payment/refund, auto-apply/post, Sales/marketplace, export or sync action is enabled. | PARTIAL - local property-finance control, not QBO equivalence. |

- Verification: `node verify-bill-balance-explanation.mjs`, Bill payment evidence, Expenses tabs, report replacement, English gate, build, and `git diff --check`. Browser bridge evidence remains unavailable for this cycle.

## Reports: retained business-fit catalog (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Retained report catalog | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the QBO homepage. | The visible Reports Center catalog is limited to Trial Balance, General Ledger, Balance Sheet, Income Statement/P&L, Cash Flow, AP Aging, AR Aging, and Reconciliation History. It keeps entity/period scope, POSTED local evidence state, full-page drill, and explicit Back. | PARTIAL - local source contract/build verified; QBO catalog, labels, permissions and responsive behavior remain unobserved. |
| Excluded QBO surfaces | Assistant3 business-fit review excludes custom/management reports, dashboards/KPIs, financial planning, Spreadsheet Sync, external/bank connections, automatic actions, Sales and payment channels. | Those reference-only shells are not rendered in the local Reports Center; retained catalog actions do not create, save, share, subscribe, email, print, export, connect, sync, post, or adjust. | PARTIAL - business-fit local scope, not a QBO equivalence claim. |

- Verification: `node verify-reports-business-scope.mjs`, report English/full-page gates, singleton navigation gate, build, and `git diff --check`. Browser bridge evidence remains unavailable for this cycle.

## Reports: single-destination navigation and English report shell (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| One-child navigation | User-provided REFS screenshot showed Journal Entry and Reports exposing duplicate child rows despite having one destination each. | Every one-child navigation group now opens its destination from the parent click and does not render a redundant child row. This includes Journal Entry and Reports. | PARTIAL - local runtime contract/build verified; browser bridge exposes no page for screenshot verification. |
| Report title and independent detail return | Assistant3 business-fit review: retain TB, GL Detail, Balance Sheet, P&L, Cash Flow, AP/AR Aging and Bank/Reconcile History, with all amounts drilling to a scoped independent detail and Back. | Reports Center and the current-period revenue KPI render in English. Existing report details replace the list and provide `Back to Reports Center` / `Back to [Report]`, retaining the local evidence scope rather than appending detail underneath. | PARTIAL - local source contract/build verified; QBO report labels, populated drills, permissions and responsive behavior remain unobserved. |

- Business boundary: include entity, period/as-of, property/project, loan, cash scope and local-evidence/Review state. Exclude custom/save/share/subscribe/email/print/export, management packs, forecasts/KPIs, external/bank connections, Spreadsheet Sync, automatic posting/adjustments, and Sales/payment channels.

## Accounting: English Chart of Accounts shell and retained Register/GL drills (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Chart of Accounts labels and tabs | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the QBO homepage. | The COA heading and tab labels render as `Chart of Accounts`, `WBS chart of accounts (766)`, and `Local posting accounts`. Legacy localized return context normalizes to these English labels. | PARTIAL - local source contract/build verified; QBO labels, responsive behavior, permissions, and populated tab interactions remain unobserved. |
| Read-only accounting drill boundary | Assistant3 business-fit review: preserve entity, account code/name/type, control, property/project, loan, cash scope, source, debit/credit/balance, and POSTED/matched/cleared/reconciled/review status. | The local posting-account table retains functional Register/GL drills and explicit returns. Account creation/edit/merge/delete/activation, imports/exports/print, external feeds/sync, automatic actions, and Sales are unavailable. | PARTIAL - business-fit local workflow, not a QBO equivalence claim. |

- Verification: `node verify-accounting-english-tabs.mjs`, English gate, report drill replacement gate, build, and `git diff --check`. The browser bridge exposed no QBO tab during this cycle.

## Expenses: English tab normalization and retained drill scope (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Expenses workspace labels | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the QBO homepage. | Expenses tabs render as Bills, Payments, AP Aging, and Vendors. Legacy localized route contexts normalize to the English tabs, including Vendor-to-AP-Aging returns. | PARTIAL - local source contract/build verified; QBO labels and tab behavior remain unobserved. |
| Local drill boundary | Assistant3 review for property finance: retain entity, vendor/related-party, property/project, category, dates, original/paid/credit/open amount, cash scope, source and posted/matched/cleared/reconciled status. | Existing full-page Bill/Payment/Vendor/Aging drills retain scope and explicit Back. Missing or cross-scope evidence remains Review/empty; no external connection, payment rail, OCR, auto-match/post, export, sync, marketplace or Sales workflow is added. | PARTIAL - business-fit local workflow, not a QBO equivalence claim. |

- Verification: `node verify-expenses-english-tabs.mjs`, `node build.mjs`, and `git diff --check`. Browser evidence remains unavailable for this cycle.

## Expenses: Vendor evidence to Bill full-page return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Vendor evidence to Bill to Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the QBO homepage. | An existing local Vendor evidence row now opens the selected Bill as a full-page detail. Back to Vendor evidence rehydrates the exact vendor page instead of dropping into Expenses or appending a detail below the vendor list. The downstream retained Payment detail still returns through the Bill. | PARTIAL - same-vendor local return contract verified; QBO populated vendor/bill drill, permissions and audit behavior remain unobserved. |

- Assistant3 business-fit review applied: retain entity/related-party/property-project/AP-GL evidence; exclude vendor portal, Bill Pay, external connections, auto-pay/posting, OCR/import, exports and ecommerce flows. `node verify-vendor-bill-return.mjs`, `node verify-vendor-listing.mjs`, `node verify-bill-payment-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| AP Aging control-difference JE → Source Document → Back to same Aging | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A JE entered from AP Aging now passes its retained AP scope when opening its source. Source Documents displays **Back to AP Aging** for that route, restoring the same as-of and control-difference context instead of sending users to a global Expenses list. | PARTIAL — local scope/return contract/build verified; QBO AP Aging, source, permission, audit and responsive behavior remain unobserved. |
| AP control exception boundary | No fresh QBO evidence this cycle. | No retained source, no POSTED open balance as-of, unapplied/over-applied payment or credit, void/reversal timing, missing/cross-entity dimensions and deposits/trust/restricted funds remain Review/empty. No adjustment, write-off, posting, payment link, external connection, email/export/share, channel or Spreadsheet Sync action is enabled. | PARTIAL — assistant3 business-fit guidance, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-source-document-je-return.mjs`, `node verify-ap-aging-return-context.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

## Reports — GL/TB Source Document → JE report-scope return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| GL Detail/TB drill → Source Document → JE → source → same report | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A Source Document opened from GL/TB now carries the complete report return context when it opens a JE. JE returns to the focused source and displays the retained report name; Source Documents already returns to the exact GL/TB entity, period/as-of, account and dimension scope. | PARTIAL — local chained-return contract/build verified; QBO report/source/JE drill, filters, permissions, audit and responsive behavior remain unobserved. |
| Real-estate reporting boundary | No fresh QBO evidence this cycle. | No posted source, no activity, missing/cross-entity dimension, unavailable source and void/reversal-only evidence remain scoped empty/Review. CWIP/prepaid, land/buildings, restricted/escrow/trust cash, loans and related-party activity retain their dimensions and are not cross-scope aggregated. | PARTIAL — assistant3 business-fit guidance, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-source-document-je-return.mjs`, `node verify-report-return-context.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification. JE editing/deleting/copying, external attachments/connections, auto-adjust/post, email/export/share, Spreadsheet Sync, Sales/payment channels, WBS/kernel and AI are excluded.

## Expenses — Bill Source Document → JE retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bill → Source Document → JE → Source → Bill | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A focused Source Document now carries its upstream Bill/Receipt origin into **Open JE**. Journal Entry visibly returns to that exact Source Document, which retains its existing **Back to Bill** control. No detail is appended below a report, register or list. | PARTIAL — local chained-return contract/build verified; QBO Bill/source/JE drill, permissions, attachment roles, audit and responsive behavior remain unobserved. |
| Source register row → JE → same focused document | No fresh QBO evidence this cycle. | The Source Documents register's row-level **Open JE** action now also carries its selected document ID. The JE Back returns to the focused source document instead of a generic or unrelated document list. | PARTIAL — local return contract verified; row-level QBO behavior remains unobserved. |
| Evidence-only boundary | No fresh QBO evidence this cycle. | The chain displays retained evidence only; it cannot alter Bill/JE/source/bank/reconciliation state. Missing source or JE stays explicit; CWIP/prepaid, restricted/escrow/loan, related-party and cross-entity cases remain Review boundaries. | PARTIAL — local property-finance safety control, not QBO equivalence. |

- Existing AP business-fit guidance applies. `node verify-source-document-je-return.mjs`, `node verify-bill-source-return.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

## Expenses — Bill evidence → Source Document retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bill Detail → retained local source document → Back to Bill | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | The Bill evidence trace now transfers its exact Bill ID into Source Documents. The focused source view visibly offers **Back to Bill**, reopening the originating full-page Bill Detail instead of a generic AP list or an appended detail. | PARTIAL — local return contract/build verified; QBO Bill/source drill, permissions, audit, attachments and responsive behavior remain unobserved. |
| Expense evidence boundary | No fresh QBO evidence this cycle. | The path remains read-only retained evidence only. It cannot upload/OCR/autofill, create/approve/edit/pay/delete/refund a bill, import or auto-match a bank item, post/clear/sign off, connect/sync or export. CWIP/prepaid, restricted/escrow/loan, related-party and cross-entity cases remain Review boundaries. | PARTIAL — existing AP business controls, not QBO equivalence. |

- Existing AP business-fit guidance applies. `node verify-bill-source-return.mjs`, `node verify-bill-evidence-trace.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

## Accounting — signed Reconcile statement → Bank evidence retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Signed Reconcile Statement Detail → retained Bank item → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A Bank Detail opened from immutable Reconcile History now sends the entire retained reconciliation context back, including the signed `historyId`, rather than falling into the current/global reconciliation queue. The visible Back scope identifies the signed statement when available. | PARTIAL — local snapshot-return contract/build verified; QBO statement detail, drill permissions, audit, responsive behavior and reopened-state interactions remain unobserved. |
| Reconciliation control boundary | No fresh QBO evidence this cycle. | The drill remains read-only. Missing bank item/POSTED JE, not-cleared/reopened/not-signed, amount-direction-account mismatch, missing/cross-entity dimension and escrow/restricted/trust/loan/related-party exceptions remain Review/empty; matched does not imply cleared or signed-off. | PARTIAL — assistant3 business-fit guidance, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-reconciliation-bank-history-return.mjs`, `node verify-reconciliation-history-detail.mjs`, `node verify-reconciliation-journal-return.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification. No feed/import/OCR, matching/clearing/adjusting/posting, payment/refund, audit sharing/export, channels or external sync is enabled.

## Sales / Receivables — Invoice → Receipt/Bank evidence retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Invoice Detail → source/receipt JE or exact Bank CREDIT → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Every Invoice Detail evidence drill now carries its originating Invoice ID, tab, Receipts filter and as-of scope. JE renders **Back to Invoice detail**; Bank Detail returns with the same label instead of treating an invoice-origin bank credit as the generic customer-receipts list. | PARTIAL — local return contract/build verified; QBO Invoice, receipt, payment allocation, bank drill, permissions and audit remain unobserved. |
| Invoice → JE → Source Document → Back to Invoice | No fresh QBO evidence this cycle. | When an invoice-origin JE opens a retained Source Document, that document now visibly provides **Back to Invoice detail** using the retained Invoice ID, tab, Receipts filter and as-of scope. | PARTIAL — local chained-return contract verified; QBO source drill behavior remains unobserved. |
| AR Aging / property funds boundary | No fresh QBO evidence this cycle. | The flow verifies retained POSTED receipt and exact local Bank CREDIT only. No receipt, no exact credit, unapplied/over-applied, void/reversed, missing/cross-entity dimension and restricted/deposit/prepayment/related-party cases remain Review or explicit empty states; matched never implies cleared/signed-off. | PARTIAL — assistant3 business-fit guidance, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-invoice-evidence-return.mjs`, `node verify-invoice-detail-return.mjs`, `node verify-invoice-receipt-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification. Online payment links/ACH/cards/refunds, customer portal/CRM, bank feed/OCR/auto-match/posting, sales channels, external connections and export remain excluded.

## Expenses — Receipt evidence → Source Document retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Receipt evidence → retained local source → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | **Open local source** now passes the exact Receipt Detail/list context into Source Documents. Source Documents visibly offers **Back to Receipt evidence**, returning to the original Receipt Detail rather than an unrelated source register or appended list detail. | PARTIAL — local return contract/build verified; QBO Receipt source drill, role permission, audit, attachment visibility and responsive behavior remain unobserved. |
| Expense evidence boundary | No fresh QBO evidence this cycle. | The new path only displays retained source/JE evidence. It does not upload/OCR/email a receipt, create an Expense or Bill, auto-categorize/match/post, pay/refund, sync an external service or alter Bank/Reconcile state. CWIP/capitalized, prepaid, tax/insurance/HOA, escrow/restricted, loan and related-party scopes remain Review boundaries. | PARTIAL — assistant3 business-fit guidance, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-receipt-source-return.mjs`, `node verify-receipt-return-context.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

## Accounting — Account Register → scoped GL Detail retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Account Register → GL Detail/JE → Back to Register | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Both visible Register-to-GL entries now open the selected account's GL Detail with the same entity, From/Through period, account label and retained Register return context. The GL/JE path therefore returns to the original Register scope rather than a global ledger or a detail panel below the Register. | PARTIAL — local scope/return contract and build verified; QBO Register/GL drill, source visibility, permissions, audit and responsive behavior remain unobserved. |
| Property finance / empty boundary | No fresh QBO evidence this cycle. | The handoff stays POSTED local evidence only. Operating, restricted/escrow/trust, loan-draw, deposits, CWIP/prepaid and related-party activity retain their account/dimension boundary; missing opening basis, missing/cross-entity dimensions or no local activity stay explicit Review/empty cases. | PARTIAL — assistant3 business-fit guidance, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-account-register-return.mjs`, `node verify-account-register-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification; no QBO state, reconciliation, payment, posting, export or connector action is enabled.

## Accounting — signed Reconcile History → Register statement-cutoff context (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Signed Reconcile History → Account Register → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | The signed-history Register target now carries statement cutoff metadata in addition to entity, mapped cash account, signed period and snapshot IDs. Register visibly identifies the signed statement cutoff while its existing Back returns to the same immutable History detail. | PARTIAL — local cutoff/return contract and build verified; QBO history/Register roles, filters, audit and responsive behavior remain unobserved. |

- Assistant3 business-fit review applied before implementation. `node verify-account-register-return.mjs`, `node verify-reconciliation-history-route.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — Trial Balance as-of → JE return semantic (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| TB cumulative account drill → JE/source → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | The report-return contract now carries an explicit `asOf` marker. A JE or source opened from a Trial Balance cumulative account drill returns to the same cumulative opening-to-as-of transaction detail rather than degrading to From-To activity. | PARTIAL — local return semantic/build verified; QBO TB drill, source visibility, filters, permissions and audit remain unobserved. |

- Assistant3 business-fit review applied before implementation. `node verify-trial-balance-asof-return.mjs`, `node verify-report-return-context.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Expenses — Bill Detail → Payment Detail retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bill Detail → Payment Detail → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A posted Bill now exposes **Open payment detail**. Payment Detail replaces the Bill screen and has an explicit **Back to Bill** action; its Bank/JE return marker reconstructs the same Bill-origin Payment Detail before the user returns to the Bill. | PARTIAL — local navigation and evidence boundaries verified; QBO Bill/Payment drill, as-of allocation, permissions and audit remain unobserved. |
| Payment / credit boundary | No fresh QBO evidence this cycle. | Existing payment detail still distinguishes absent POSTED payment, absent exact Bank DEBIT and absent signed reconciliation. Bill amount, payment proof, credit/reversal evidence and property/project scope stay visible; no bank/payment state, credit application or Bill status is changed. | PARTIAL — assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-bill-payment-detail-return.mjs`, `node verify-payment-detail-empty-return.mjs`, `node verify-payment-signed-history-return.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — TB / GL scoped Register period-preserving drill (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Trial Balance / GL account drill → Account Register → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | An eligible single cash or AR/AP-control account now carries both report **From** and **Through** periods into Register, in addition to the retained report entity, Property/Project/Loan/cash scope and account drill. Register then returns to the originating report scope rather than appending detail below it. | PARTIAL — local period/return contract and build verified; QBO drill, filters, source visibility, permissions, audit and responsive behavior remain unobserved. |
| Scope / empty-state boundary | No fresh QBO evidence this cycle. | Aggregate, non-cash, missing-dimension, cross-entity or zero-activity drills stay unavailable or Review-only; restricted/escrow/trust, loan, CWIP/prepaid and related-party activity is not silently converted into operating cash or a global zero balance. | PARTIAL — assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-report-account-register-return.mjs`, `node verify-report-return-context.mjs`, `node verify-report-scope-empty-state.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Accounting — Account Register → Reconcile period-preserving return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Account Register → Reconcile → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Both Register-level Reconcile entry points and the selected-entry action now retain entity, mapped single cash account, **From/Through** period and entry ID. The Register consumes those retained dates on return, so opening/in-period/ending balances keep the same POSTED-only scope. | PARTIAL — local return contract and build verified; QBO statement detail, role permissions, audit, filtering and responsive behavior remain unobserved. |
| Cash / statement scope boundary | No fresh QBO evidence this cycle. | Reconcile is unavailable for non-cash/unmapped accounts. Operating, restricted/escrow/trust and loan cash remain distinct scopes; missing/cross-entity evidence, CWIP/prepaids, deposits and related-party transactions cannot infer cleared or signed-off status. | PARTIAL — assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-account-register-return.mjs`, `node verify-account-register-evidence.mjs`, `node verify-reconciliation-history-route.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Expenses — Payment Bank → signed Reconcile History retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Payment Detail → exact Bank DEBIT → signed reconciliation snapshot → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A Payment bank-evidence detail now opens signed reconciliation history only when its retained lifecycle contains a signed snapshot. The return contract is History → exact Bank DEBIT → the same Payment Detail → original Bill payments scope, with an explicit detail-origin marker. | PARTIAL — local navigation contract and build verified; QBO history drill, role permissions, source visibility and audit remain unobserved. |
| Unsigned / conflicting payment boundary | No fresh QBO evidence this cycle. | Cleared-but-unsigned evidence shows **No retained signed-off reconciliation for this payment scope**; unmatched/uncleared evidence remains unavailable. Matched, cleared and signed-off stay independent facts; restricted/escrow/trust, loan, CWIP/prepaid, related-party and cross-entity cases remain Review boundaries. | PARTIAL — assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-payment-signed-history-return.mjs`, `node verify-bank-signed-history-return.mjs`, `node verify-payment-detail-empty-return.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Expenses — Payment detail empty-state and retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Payment row → full-page Payment Detail → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Payments now opens a full-page, read-only Payment Detail instead of sending a user to an indistinct Bill screen or appending details below the list. **Back to Bill payments** restores the retained Bill ID, date filter and Payments tab. | PARTIAL — local UI contract and build verified; QBO payment-detail drill, filters, permissions and audit remain unobserved. |
| Payment / Bank / Reconcile evidence boundary | No fresh QBO evidence this cycle. | The detail explicitly distinguishes `NO_POSTED_PAYMENT_EVIDENCE`, `NO_EXACT_LOCAL_BANK_DEBIT`, `NO_ELIGIBLE_RECONCILIATION_RECORD`, and a retained signed record. A posted AP payment therefore never implies bank clearance or reconciliation; its entity/property/project, cash scope and JE remain visible. | PARTIAL — assistant3 business-fit guidance applied; this is not claimed as QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-payment-detail-empty-return.mjs`, `node verify-payment-evidence-drill.mjs`, `node verify-payment-history-listing.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — Balance Sheet cash Register period-preserving return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Balance Sheet cash row → Account Register → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | An eligible Balance Sheet cash-row Register drill now carries From and as-of To, keeping Register opening/activity/ending aligned to the BS report scope. Its retained report return continues to restore entity, Property/Project/Loan and cash scope. | PARTIAL — local period contract and build verified; QBO BS drill/GL/JE/source behavior, permissions and audit remain unobserved. |
| Asset / funds boundary | No fresh QBO evidence this cycle. | CWIP, land, fixed assets and prepaids remain GL-only and cannot masquerade as a cash Register. Operating, escrow/restricted/trust/deposit and loan-draw cash remain distinct; no asset valuation, auto-depreciation, adjustment, posting, connector or export action is enabled. | PARTIAL — Assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-balance-sheet-register-return.mjs`, `node verify-balance-sheet-register-period-return.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — Cash Flow → Register period-preserving return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Cash Flow cash scope → Account Register → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A complete single cash-scope Cash Flow drill now carries both From and To into Account Register, so Register opening balance plus in-period activity uses the exact Cash Flow period. Its existing report return retains the same entity, Property/Project/Loan, cash scope and original Cash Flow view. | PARTIAL — local period contract and build verified; QBO cash-flow/register/BS handoff, permissions and audit remain unobserved. |
| Real-estate cash boundary | No fresh QBO evidence this cycle. | Only an exact mapped local cash account and complete dimension scope may drill; aggregate/conflicting scope stays GL Review. Operating, restricted/escrow/trust, deposits and loan-draw cash remain separate and are not presented as available operating cash. | PARTIAL — Assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-cash-flow-register-return.mjs`, `node verify-cash-flow-register-period-return.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — Income Statement scoped empty-state boundary (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Income Statement → scoped GL Detail / JE → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. Existing local amount drills already replace P&L with scoped GL detail and return using the original report state. | The P&L empty state now distinguishes missing entity, no same-entity POSTED activity, and a valid scope with no revenue/expense. It shows From/To and Property/Project/Loan scope and never presents CWIP, prepaids, deposits, escrow or restricted cash as a zero-valued operating P&L surrogate. | PARTIAL — local scoped empty-state and build verified; QBO P&L drill, source visibility, filters, permissions and audit remain unobserved. |
| Real-estate reporting boundary | No fresh QBO evidence this cycle. | Income/expense remains same-scope POSTED accrual evidence; capitalized/CWIP/prepaid/deposit/escrow/related-party and missing/cross-entity dimensions retain their balance-sheet or Review treatment. No cash-basis auto-recompute, sales/KPI, budget/forecast, sync, sharing/export or adjustment/posting action is enabled. | PARTIAL — Assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-income-statement-scope-empty.mjs`, `node verify-report-account-register-return.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Accounting — Account Register opening balance / period scope (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Account Register opening + in-period activity → GL Detail → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Register now has explicit From/Through periods, displays its retained opening balance separately, and calculates running/ending balance as opening plus same-entity POSTED activity in the selected period. **Run Report** carries both dates to GL Detail and preserves them in the Register return context. | PARTIAL — local opening/running calculation, return contract and build verified; QBO register period controls, opening-balance behavior, permissions and audit remain unobserved. |
| Real-estate account boundary | No fresh QBO evidence this cycle. | Cash-only Register selection remains limited to retained Operating/Escrow/Restricted/security-deposit/payroll-restricted scope; non-cash accounts remain GL Detail. Missing opening basis, no POSTED activity, no bank evidence and cross-scope facts remain explicit local empty/Review outcomes rather than a synthetic zero/global balance. | PARTIAL — Assistant3 business-fit control, not QBO equivalence. |
| Exclusions | No fresh QBO evidence this cycle. | No Register edit/delete, feed/import/OCR, automatic match/adjust/post, statement ingestion, payment/sales channel, external sync or export is enabled. | PARTIAL — deliberate operating boundary. |

- Assistant3 business-fit review applied before implementation. `node verify-account-register-evidence.mjs`, `node verify-account-register-return.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Expenses / Accounting — Bank evidence → signed Reconcile History → Back (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bank Transaction evidence → signed reconciliation snapshot → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A Bank evidence detail now exposes **Open signed reconciliation history** only when that exact bank id is retained in the matching account/period/statement signed snapshot. The immutable history detail visibly returns to the same bank item, whose existing Back returns to the originating bank queue. | PARTIAL — local lifecycle, history route and build verified; QBO transaction-to-history navigation, permissions, audit and responsive behavior remain unobserved. |
| Clearing / sign-off gate and empty states | No fresh QBO evidence this cycle. | Match, cleared and signed-off remain independent facts. If an item is not cleared, the action states **Not cleared in a retained signed statement**; if cleared but no compatible snapshot exists it states **No eligible signed reconciliation record**. Missing source, entity/account/dimension conflict, reopened snapshot and duplicate candidates remain Review and never acquire a signed status. | PARTIAL — local control boundary, not QBO equivalence. |
| Real-estate and external boundary | No fresh QBO evidence this cycle. | Operating, restricted/escrow/trust and loan-draw scopes remain separated. Rent/prepayment, deposit, related-party, cross-entity and same-amount ambiguity remain Review. No feed/download/import/OCR, automatic match/clear/adjust/post, payment/refund, connection/sync, sales channel or export is enabled. | PARTIAL — Assistant3 business-fit boundary. |

- Assistant3 business-fit review applied before implementation. `node verify-bank-signed-history-return.mjs`, `node verify-bank-transaction-lifecycle.mjs`, `node verify-reconciliation-history-route.mjs`, `node verify-reconciliation-history-detail.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Receivables — Invoice / Receipt full-page retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Invoice list or Customer Receipt → Invoice detail → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Invoice and Customer Receipt drills now capture their return scope before opening the full-page Invoice evidence. Back restores the originating Invoices or Receipts view and its retained as-of date; a supplied AR Aging origin continues to show its dedicated Aging return label. Detail never appears beneath a table. | PARTIAL — local return contract and build verified; QBO Invoice/Receipt/Aging drill behavior, filters, permissions and audit remain unobserved. |
| AR control boundary | No fresh QBO evidence this cycle. | Existing AR Aging remains a read-only, same-entity, retained POSTED control bridge: valid non-void Invoice less effective Receipt evidence as of date. Prepayments/deposits, restricted/escrow funds, related-party and missing/cross-scope evidence stay Review and do not silently reduce AR. | PARTIAL — Assistant3 business-fit control, not QBO equivalence. |
| Exclusions | No fresh QBO evidence this cycle. | No payment link, online collection, refund, customer portal/CRM, bank feed, automatic allocation/match, sales channel, external connector/sync/export or posting action is exposed. | PARTIAL — deliberate operating boundary. |

- Assistant3 business-fit review applied before implementation. `node verify-invoice-detail-return.mjs`, `node verify-ar-aging.mjs`, `node verify-invoice-receipt-evidence.mjs`, `node verify-invoice-payment-lifecycle.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Expenses — Bill → AP Aging / AP-control bridge retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| AP Aging Bill row → Bill detail → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Opening a Bill from a selected AP Aging bucket now replaces the report with the existing full Bill evidence view. Its top action explicitly says **Back to AP Aging** and shows the retained vendor, as-of date and bucket; Back restores that same report scope instead of sending the user to a generic Expenses list or appending detail below the table. | PARTIAL — local navigation and build verified; QBO Bill/Aging handoff, filter persistence, permissions and audit behavior remain unobserved. |
| Bill aging / AP-control control chain | No fresh QBO evidence this cycle. | Existing AP Aging remains restricted to retained same-entity POSTED, non-void Bill evidence less effective posted Payments and exact applied Credits as of the selected date. The visible AP Aging→GL control bridge remains read-only; later payments/credits do not rewrite the historical as-of result. | PARTIAL — local evidence controls verified; QBO controls and report calculations remain unobserved. |
| Real-estate exclusions | No fresh QBO evidence this cycle. | CWIP/prepaid/capitalized/related-party, escrow/trust/loan-draw and missing/cross-entity or dimension-conflict cases remain Review, never automatic netting. Bill Pay, payment/refund, bank feed/OCR, auto-application/match, external portal/sync and sales/payment channels remain unavailable. | PARTIAL — Assistant3 business-fit boundary, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-ap-aging-credit-drill.mjs`, `node verify-ap-aging.mjs`, `node verify-aging-gl-tb-bridge-evidence.mjs`, `node verify-bill-evidence-trace.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Accounting — COA cash-only Register / scoped GL return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| COA account row → Register or GL Detail → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. Earlier read-only COA evidence observed `View register`/`Run report` row actions but not their return behavior. | The COA keeps the current entity, list tab and name/number filter for **both** drills. Only retained Operating/Escrow/Restricted/security-deposit/payroll-restricted cash accounts expose **View register**; every AR/AP, CWIP, prepaid, fixed-asset, liability, equity, income and expense account opens scoped **GL Detail** with a visible **Back to Chart of Accounts** action. No detail is appended beneath the COA table. | PARTIAL — local drill routing, return contract and build verified; QBO action eligibility, filter persistence, permissions, audit and responsive behavior remain unobserved. |
| Cash-account Register eligibility / empty boundary | No fresh QBO evidence this cycle. | Account Register selection is limited to locally classified cash scopes. It retains only same-entity POSTED evidence and preserves the existing no-entity/no-activity/no-local-bank-mapping review states; non-cash accounts cannot masquerade as a bank register. Operating, escrow, restricted, security-deposit and payroll-restricted funds remain separate. | PARTIAL — business-fit local control, not QBO equivalence. |
| Exclusions | No fresh QBO evidence this cycle. | No account create/edit/merge/activate/deactivate, batch action, bank feed/import/OCR, auto-match/clear/sign-off/post, external sync/export, QBO payment channel, sales connector or WBS/kernel behavior is enabled. | PARTIAL — deliberate operating boundary. |

- Assistant3 business-fit review applied before implementation: cash-only Register; all other account types stay in scoped GL; preserve entity/account/period/dimension return scope and surface missing/cross-scope evidence as Review. `node verify-chart-account-actions.mjs`, `node verify-account-register-evidence.mjs`, `node verify-account-register-return.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Expenses — AP Aging applied-Credit detail return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| AP Aging → applied Vendor Credit evidence → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | An Aging row with retained applied-credit evidence now exposes **Credit evidence** beside the applied amount. It opens the existing full-page Vendor Credit detail and returns to AP Aging with the current vendor, as-of date and aging bucket, rather than appending the application details below the table. | PARTIAL — local credit/aging return and build verified; QBO vendor-credit application detail, fields, permissions and audit behavior remain unobserved. |
| Credit application gate | No fresh QBO evidence this cycle. | Only same-entity/vendor, retained POSTED Bill/Credit/Payment evidence inside the as-of cutoff contributes applied credit; credit application remains bounded by the Bill unpaid amount and available credit. The drill is read-only and cannot apply, refund, void, pay, post or alter bank/reconcile evidence. | PARTIAL — local control boundary, not QBO equivalence. |
| Real-estate Review boundary | No fresh QBO evidence this cycle. | CWIP/prepaid/capitalized source gaps, related-party audit gaps, cross-entity or dimension mismatch, over/unapplied credit, later void/reversal and signed-bank situations remain Review and are never auto-netted. No Bill Pay, external vendor/bank/OCR, auto-application, external sync/export or payment channel is offered. | PARTIAL — Assistant3 business-fit control boundary; QBO behavior remains unverified. |

- Assistant3 business-fit review applied before implementation. `node verify-ap-aging-credit-drill.mjs`, `node verify-ap-aging.mjs`, `node verify-vendor-credit-evidence.mjs`, `node verify-vendor-credit-return.mjs`, `node verify-bill-payment-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — Cash Flow cash-scope Register return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Cash Flow cash scope → Account Register / Reconcile → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A Cash Flow scope retains its existing amount-to-GL drill and now shows **Open local register** only when the current scope resolves to one complete local cash account. Register preserves From/To, entity, Property/Project/Loan and cash scope; its existing Reconcile path returns through Register to the same Cash Flow view. | PARTIAL — local register/reconcile return chain and build verified; QBO Cash Flow drill/reconcile behavior, filter persistence and permissions remain unobserved. |
| Cash Flow control boundary | No fresh QBO evidence this cycle. | The path is read-only POSTED evidence: opening + Operating/Investing/Financing movement = closing, with BS/GL/TB/Register controls kept separate from matched/cleared/signed-off facts. Aggregate/conflicting, unclassified, source-missing, cross-entity and scope-conflict rows remain GL Review rather than a Register action. | PARTIAL — local control boundary, not QBO equivalence. |
| Real-estate funds boundary | No fresh QBO evidence this cycle. | Internal transfers do not enter the three cash-flow categories; deposits/prepayments, escrow/trust/restricted funds and loan draws remain separately scoped and never become available Operating cash. No feed, auto-classification, forecast, scenario model, adjustment/posting, external sync/export or payment channel is provided. | PARTIAL — Assistant3 business-fit control boundary; QBO behavior remains unverified. |

- Assistant3 business-fit review applied before implementation. `node verify-cash-flow-register-return.mjs`, `node verify-cash-flow-evidence.mjs`, `node verify-report-return-context.mjs`, `node verify-account-register-return.mjs`, `node verify-reconciliation-local-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — Balance Sheet cash Register return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Balance Sheet cash row → scoped GL / Account Register → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Balance Sheet cash rows retain their existing amount-to-full-page GL drill and now expose a separate **Open local register** action. It is enabled only for a complete-scope mapped cash account and returns to the same Balance Sheet tab, as-of period, entity, Property/Project/Loan and cash scope instead of a generic report or appended panel. | PARTIAL — local as-of navigation/build verified; QBO Balance Sheet drill actions, filter persistence, responsive behavior and permissions remain unobserved. |
| Cash availability boundary | No fresh QBO evidence this cycle. | Only cumulative POSTED local evidence through the selected cutoff is shown. Operating, Restricted/Escrow/Trust and Loan cash remain distinct; this path does not infer available cash from Cash Flow, AR/AP Aging, un-cleared bank items or cross-entity activity. | PARTIAL — Assistant3 business-fit control boundary, not QBO equivalence. |
| Review / empty boundary | No fresh QBO evidence this cycle. | Incomplete entity/dimension scope and noncash/control accounts have no direct Register handoff; missing source, opening and dimension proof remains a GL review or explicit empty state. No bank connection, forecast, report sharing/email/export, auto-adjustment or posting is provided. | PARTIAL — local boundary; QBO behavior unverified. |

- Assistant3 business-fit review applied before implementation. `node verify-balance-sheet-register-return.mjs`, `node verify-balance-sheet-asof.mjs`, `node verify-report-return-context.mjs`, `node verify-report-account-register-return.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Accounting — Reconciliation History Account Register return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Signed-off Reconcile History → Account Register → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A retained signed reconciliation snapshot with the matching active entity and exactly mapped cash account now exposes **Open Account Register**. The full Register replaces the snapshot detail, displays per-row reconciliation evidence, and visibly returns to the same Reconcile History snapshot rather than appending transactions below it. | PARTIAL — local signed-snapshot route, return and build verified; QBO history/register handoff, account eligibility, pagination, audit and permissions remain unobserved. |
| Cleared / signed-off evidence boundary | No fresh QBO evidence this cycle. | Register keeps POSTED JE running balances separate from bank matching. Only a bank item contained in the retained snapshot may display `CLEARED_SIGNED_OFF`; unmatched, uncleared or outside-snapshot evidence remains Review and cannot alter clearing/sign-off. | PARTIAL — local evidence contract, not QBO equivalence. |
| Real-estate cash separation | No fresh QBO evidence this cycle. | The handoff is disabled unless entity and single local bank mapping agree. Operating, restricted/escrow/trust and loan cash remain distinct; deposits/prepayments, related-party, cross-entity and unproven dimensions cannot be consolidated or silently treated as operating cash. | PARTIAL — Assistant3 business-fit control boundary; QBO dimensions and permissions remain unverified. |

- Assistant3 business-fit review applied before implementation. `node verify-reconciliation-register-return.mjs`, `node verify-account-register-evidence.mjs`, `node verify-account-register-return.mjs`, `node verify-reconciliation-history-detail.mjs`, `node verify-reconciliation-history-route.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Expenses — Vendor Payment reconciliation return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Vendor Payment → exact bank DEBIT → Reconcile → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A valid local Payment bank-evidence detail can open Reconcile only through the exact local-match gate. Reconcile replaces the workspace and its visible Back action restores **Bill payments** plus the original payment-date filter; it no longer reopens a Bill detail merely because its return marker contains a bill ID. | PARTIAL — local return/gate/build verified; QBO Bill Pay, reconciliation entry/clearing/sign-off, filters, permission and audit behavior remain unobserved. |
| Vendor payment business controls | No fresh QBO evidence this cycle. | Scope retains the Bill/Payment/POSTED JE/bank DEBIT path and prevents ineligible evidence from opening this reconcile handoff. CWIP/prepaid, tax/insurance/HOA, related-party, escrow/restricted and loan cash remain separately reviewed; no ACH/card/check/Bill Pay, refund, feed/OCR, auto-match, portal or external sync is offered. | PARTIAL — Assistant3 business-fit control boundary, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-reconciliation-receipt-return.mjs`, `node verify-payment-bank-return.mjs`, `node verify-payment-return-context.mjs`, `node verify-bill-payment-evidence.mjs`, `node verify-reconciliation-local-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Accounting — Customer Payment reconciliation return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Customer Payment → exact bank CREDIT → Reconcile → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | The Customer Payment bank-evidence action may open local reconciliation evidence only when the retained item passes the exact local-match gate. Reconcile replaces the workspace and visibly returns to the preserved Customer payments scope (Receipts view and as-of date), rather than defaulting to Bank Transactions or appending a lower panel. | PARTIAL — local navigation/gate/build verified; QBO reconciliation entry, clearing/sign-off workflow, back behavior and permissions remain unobserved. |
| Receipt reconciliation gate | No fresh QBO evidence this cycle. | The gate requires retained POSTED evidence and prevents ineligible source items from entering this receipt-origin reconciliation drill. Reconcile remains read-only: it cannot match, clear, sign off, unmatch, void, create an adjustment or alter a bank item. | PARTIAL — local control boundary, not QBO equivalence. |
| Real-estate funds boundary | No fresh QBO evidence this cycle. | Rent is AR-review evidence only. Deposits/prepayments do not reduce AR; escrow/restricted funds remain separate cash/liability scopes. Missing/nonposted, cross-entity, direction/amount/account mismatch, duplicate IDs, multiple candidates and signed-period changes remain review-only. | PARTIAL — Assistant3 business-fit guardrail; QBO policy/permission behavior remains unverified. |

- Assistant3 business-fit review applied before implementation. `node verify-reconciliation-receipt-return.mjs`, `node verify-bank-transaction-return.mjs`, `node verify-customer-payment-evidence.mjs`, `node verify-reconciliation-local-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Receivables — Customer Payment bank-evidence return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Customer Payment → exact bank CREDIT → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | From an AR **Customer payments** row, **Open bank item** replaces the workspace with the retained bank-evidence detail. Its visible Back action returns directly to **Customer payments** and restores the Receipts tab, selected receipt view and AR as-of date rather than defaulting to Bank Transactions or appending a detail panel. | PARTIAL — local return contract and build are verified; QBO receipt-to-bank navigation, filter persistence, populated-bank behavior and permissions remain unobserved. |
| Real-estate receipt boundary | No fresh QBO evidence this cycle. | Only an exact retained local CREDIT with the same posted receipt JE and amount is exposed. Tenant deposit/prepayment/escrow, partial/split/combined receipts, cross-entity/property evidence and unmatched items remain review-only; no payment link, online processor, refund, portal, bank feed, external connection or auto-match is offered. | PARTIAL — business-fit boundary, not QBO equivalence. |

- Assistant3 business-fit review applied: `Receipt / Customer Payment → Bank CREDIT → Reconcile`; direct Reconcile-to-AR return is still unimplemented and must not be treated as equivalent. `node verify-bank-transaction-return.mjs`, `node verify-customer-payment-evidence.mjs`, `node verify-invoice-receipt-evidence.mjs`, `node verify-receipt-bank-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

# Accounting — Account Register report-return scope (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Account Register → GL Detail → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | **Run Report** replaces the register with a scoped GL Detail view. It preserves the selected entity, account and through-period in a dedicated return contract; the report header visibly returns to Account Register rather than Reports or an appended lower panel. | PARTIAL — local return contract and build are verified; QBO register-to-report behavior, pagination and permissions remain unobserved. |
| Real-estate register boundary | No fresh QBO evidence this cycle. | The register remains local POSTED evidence only: entity, account, cash state, source JE, debit/credit, running balance and property/project/loan dimensions remain distinct. No register edit/delete, bank feed/import/OCR, auto-match/posting, online payment, external sync or export is provided. | PARTIAL — deliberate business boundary, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-account-register-return.mjs`, `node verify-account-register-evidence.mjs`, `node verify-report-return-context.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Accounting — Account Register reconcile-return scope (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Account Register → Reconcile → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | Both Register Reconcile entry points are enabled only for a single mapped local cash account. They carry entity, register account and through-period; Reconcile visibly returns to the same Register scope instead of opening a default account or appending a panel. | PARTIAL — local navigation/evidence/build verified; QBO reconcile handoff, populated account selection and permissions remain unobserved. |
| Cash-account eligibility | No fresh QBO evidence this cycle. | Non-cash, AR/AP, revenue/expense, CWIP and balance-sheet accounts without a single mapped local cash scope remain unavailable for Reconcile. Operating, restricted/escrow/trust and loan cash remain explicit and separate. | PARTIAL — business-control boundary, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-account-register-return.mjs`, `node verify-account-register-evidence.mjs`, `node verify-reconciliation-local-evidence.mjs`, `node verify-reconciliation-journal-return.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Accounting — Chart of Accounts register-return scope (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Chart of Accounts → Account Register → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | A local account-list Register drill now retains the selected COA tab, name/number filter and entity context. Account Register shows a top **Back to Chart of Accounts** action that restores the list scope rather than defaulting or placing details under the list. | PARTIAL — local return/build verified; QBO account-row action, filter persistence and permissions remain unobserved. |
| COA business boundary | No fresh QBO evidence this cycle. | This is read-only navigation over local POSTED evidence. New/edit/activate/deactivate, batch operations, export/print, tax mapping, bank connections/import/OCR, auto-post/match, online payments and external sync remain unavailable. | PARTIAL — deliberate real-estate control boundary, not QBO equivalence. |

- Assistant3's Accounting business-fit review governs this scoped continuation. `node verify-chart-account-actions.mjs`, `node verify-account-register-return.mjs`, `node verify-account-register-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — Trial Balance eligible-account register return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Trial Balance → Account Register → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | An eligible single-account TB row keeps its normal full-page GL-detail click and adds a separate **Open local register** action. It carries entity, from/to period, Property/Project/Loan and cash scope; Register visibly returns to the original report, not below the table. | PARTIAL — local return and scope logic are verified; QBO amount/menu drill behavior, column settings, paging and permissions remain unobserved. |
| Eligibility / controls | No fresh QBO evidence this cycle. | Only local cash groups and AR/AP control accounts can open the Register. CWIP, prepaid, fixed asset, income/expense and equity rows remain report/JE evidence; report totals use same-scope POSTED JEs only and separated escrow/restricted/loan cash cannot be folded into operating cash. | PARTIAL — deliberate real-estate control boundary, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-report-account-register-return.mjs`, `node verify-report-return-context.mjs`, `node verify-gl-dimension-scope.mjs`, `node verify-report-control-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — GL Detail eligible-account register return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| GL Detail → Account Register → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | A full-page GL transaction drill for one eligible local cash or AR/AP-control account exposes **Open local register**. The Register return restores report tab, entity, period, Property/Project/Loan, cash scope and original account drill; it never appends the register under the GL table. | PARTIAL — local scope/empty-state/build verified; QBO GL-detail menu and account-register handoff remain unobserved. |
| Aggregate / ineligible drill state | No fresh QBO evidence this cycle. | Multiple-account totals and noncash/noncontrol rows show **No register scope** with an explicit explanation; their only retained drill path remains scoped GL/JE evidence. | PARTIAL — intentional local control boundary, not QBO equivalence. |

- Assistant3's Reports scope review governs this continuation. `node verify-report-account-register-return.mjs`, `node verify-report-return-context.mjs`, `node verify-gl-drill-state.mjs`, `node verify-gl-dimension-scope.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — GL control account aging return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| GL Detail 120200 / 291001 → AR/AP Aging → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | A single AR control 120200 drill exposes **Open AR Aging** and AP control 291001 exposes **Open AP Aging**. The target retains report entity, cutoff, Property/Project/Loan, control account and report return, then visibly returns to the same GL report rather than a lower-page detail. | PARTIAL — local bridge, aging boundary and build are verified; QBO control-account aging action, permissions and populated result behavior remain unobserved. |
| Control-account boundary | No fresh QBO evidence this cycle. | No other GL account exposes Aging. Aging remains local OPEN/POSTED evidence only; partial/cross-period, reversals, deposits/trust/escrow, missing dimensions and cross-entity conflicts are review-only and cannot create allocation, adjustment, payment or posting. | PARTIAL — intentional real-estate control boundary, not QBO equivalence. |

- Assistant3's Reports control-account review governs this continuation. `node verify-report-account-register-return.mjs`, `node verify-aging-gl-tb-bridge-evidence.mjs`, `node verify-ar-aging.mjs`, `node verify-ap-aging.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — dimension-review drill boundary (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Incomplete dimension scope | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | If the report scope contains missing dimension, cross-scope or entity-mismatch evidence, the current full-page GL drill keeps the posted detail but disables Register and Aging handoffs with an explicit Review explanation. | PARTIAL — local evidence gate/build verified; QBO conflict and drill-disable behavior remains unobserved. |
| Scoped empty/review boundary | No fresh QBO evidence this cycle. | Property/Project/Loan filtering remains line-level and POSTED-only. Review rows cannot silently consolidate, cross workspace, allocate, adjust, post, pay, connect, import, export or synchronize. | PARTIAL — intentional real-estate control boundary, not QBO equivalence. |

- `node verify-report-account-register-return.mjs`, `node verify-dimension-scope-evidence.mjs`, `node verify-gl-dimension-scope.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Reports — empty GL drill boundary (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Empty GL Detail scope | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | An empty full-page GL drill retains its explicit **Back to report** action and scoped empty explanation, but disables Register and Aging handoffs with `No posted local activity exists in this scoped drill`. | PARTIAL — local empty-state/build verified; QBO empty drill, navigation and permission behavior remain unobserved. |

- `node verify-report-account-register-return.mjs`, `node verify-gl-drill-state.mjs`, `node verify-report-scope-empty-state.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Expenses — Vendor Credit application Bill return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Vendor Credit application evidence → linked Bill → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | The application-evidence table's linked Bill action now carries the Credit JE return marker. Bill detail remains a full-page replacement and returns to the originating Vendor Credit, including when opened from the application table. | PARTIAL — local return/application evidence/build verified; QBO credit application, bill detail and permission behavior remain unobserved. |
| Application boundary | No fresh QBO evidence this cycle. | Only same-entity/vendor, retained POSTED application within Bill and Credit limits can reduce Aging. Capitalized/prepaid, related-party, cross-entity, over-limit, unapplied and bank/reconcile cases remain Review; no apply/refund/pay/void/post/connect/export/sync action is enabled. | PARTIAL — deliberate real-estate control boundary, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-vendor-credit-return.mjs`, `node verify-vendor-credit-evidence.mjs`, `node verify-ap-aging.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

Status: active evidence collection
Evidence policy: authenticated QuickBooks observations are read-only. No create, submit, payment, edit, delete, connection, refresh, or settings mutation is permitted during discovery.

## Evidence grades

- `OBSERVED`: directly visible in the authenticated QuickBooks UI.
- `OFFICIAL`: supported by Intuit documentation.
- `INFERRED`: behavior inferred from labels or navigation; implementation is blocked until verified.
- `UNKNOWN`: not yet inspected.

## Expenses — external receipt/card-notification exclusion (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Purchase notifications / receipt reminders | QBO Expenses previously displayed Purchase notifications and receipt-reminder messaging in its shell. This cycle did not open, connect, configure or submit any QBO notification, card, phone, receipt or OCR flow; the active browser currently has no controllable QBO tab. | The observed entry remains visible but disabled with a business-fit explanation. REFS no longer opens a card/phone/receipt/OCR marketing panel; it retains only local Bill, Payment, Aging and Vendor-credit evidence workflows. | PARTIAL — local exclusion is unit-verified; QBO notification eligibility, connection, OCR, receipt and audit behavior are unobserved and intentionally not reproduced. |
| Bill payment → Bank → Reconcile return | No QBO Bill Pay row, payment detail, bank item, reconciliation drill or return interaction was exercised in this cycle. | The local payment-bank-reconcile path now keeps a visible Bill ID, payment-date filter and Payments tab label at both Bank Transaction and Reconcile. Back returns through the existing immutable navigation context; transaction detail never appends under Payments. | PARTIAL — local context label and return chain are verified; QBO Bill Pay network lifecycle, populated details, permissions and browser-history behavior remain unobserved. |
| Bill payment → GL / TB return | No QBO payment-row GL/TB drill was exercised in this cycle. | The payment table's GL and Trial Balance actions now pass the exact Bill, payment-date filter, Payments tab and entity into the report route. GL/TB renders a top **Back to Bill payments** action with that scope, rather than returning a user to generic Reports. | PARTIAL — local drill context is unit-verified; QBO payment-report drill behavior, permissions and history remain unobserved. |
| Bill payment → Bank evidence → JE return | No QBO payment row, bank-evidence drill, payment JE drill or Back interaction was exercised in this cycle; the current read-only browser bridge exposed no auditable tab. | From a retained payment bank-evidence page, **Open payment JE** now freezes the exact bank account, bank item and originating payment scope. JE replaces the evidence page and supplies **Back to payment bank evidence**, which reopens the same evidence page before its existing Back to Bill payments action. | PARTIAL — local navigation contract is unit-verified; QBO bank-feed/payment-link semantics, browser history, permissions and populated-row UI remain unobserved. No matching, clearing, reconciliation, posting, payment or external connection is enabled. |
| AP Aging → JE return | No QBO AP Aging row/control-difference JE drill or Back interaction was exercised in this cycle. | An AP Aging control-difference JE drill now freezes vendor, as-of cutoff and selected aging bucket. JE displays this retained scope with **Back to AP Aging**, and the AP surface reinitializes its vendor/cutoff/bucket rather than showing the JE beneath the aging report. | PARTIAL — local scope contract is unit-verified; QBO aging drill, report filter persistence, permissions and history remain unobserved. |
| Vendor Credit → linked Bill return | No QBO Vendor Credit row, linked Bill drill or Back behavior was exercised in this cycle. | Opening a retained linked Bill from a Vendor Credit now replaces the Credit page and preserves a nested Credit origin. Closing the Bill returns to that exact Credit; closing the Credit then restores the original Expenses list scope. | PARTIAL — local nested-detail return is verified; QBO credit application, refund, void, linked-Bill UI and permission behavior remain unobserved and unavailable. |
| Vendor Credit → JE return | No QBO Vendor Credit row, credit-journal drill or Back behavior was exercised in this cycle. | Opening the retained Credit JE replaces the Credit detail, freezes the exact credit key, and shows a top **Back to Vendor Credit** action. The AP route reopens that Credit instead of appending the JE beneath a report or returning generically to Expenses. | PARTIAL — local return contract is unit-verified; QBO credit journal drill, browser history, permissions, edit/apply/refund/void behavior and populated-detail layout remain unobserved and unavailable. |

- Assistant3 business-fit review applied. `node verify-vendor-credit-return.mjs`, `node verify-vendor-credit-evidence.mjs`, `node verify-ap-aging-return-context.mjs`, `node verify-ap-aging.mjs`, `node verify-ap-vendor-credit-aging.mjs`, `node verify-expense-business-scope.mjs`, `node verify-payment-return-context.mjs`, `node verify-report-return-context.mjs`, `node verify-report-launch-context.mjs`, `node verify-expense-listing.mjs`, `node verify-expense-detail-return.mjs`, `node verify-bill-payment-evidence.mjs`, `node verify-bank-transaction-return.mjs`, `node verify-bank-reconciliation.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Accounting — Receipt evidence → JE retained return (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Receipt evidence → JE return | No fresh QBO receipt drill was available this cycle: the current browser bridge exposed no auditable tab. Earlier QBO observation established only the Receipts list shell and empty state, not a populated receipt or Back behavior. | Accounting → Receipts already replaces the list with a retained Receipt detail. Its source-JE drill now freezes the exact receipt id, review view and local filter. JE replaces the detail and provides **Back to Receipt evidence**, reopening that same receipt rather than appending a JE below the receipt list or returning generically. | PARTIAL — local return scope is unit-verified. QBO receipt extraction/review, populated detail, JE drill, browser history, permissions/audit and responsive behavior remain unobserved; upload/OCR/forwarding/autofill/conversion/export/external storage remain excluded. |
| Receipt evidence → Bank evidence return | No fresh QBO receipt-row bank drill or Back action was available this cycle; no QBO record was changed. | The same Receipt detail now passes its exact retained receipt scope into Bank transactions. Bank evidence replaces the Receipt screen and its existing Back action restores that Receipt detail with the prior review view and local filter, never a generic bank-list state. | PARTIAL — local return target is unit-verified. QBO bank-feed linkage, receipt review, matching/clearing/reconcile behavior, permissions/audit and browser history remain unobserved; no external bank connection or automatic action is provided. |
| Bank evidence → JE return | No fresh QBO Bank transactions row, matched-JE drill or Back interaction was available this cycle: the browser bridge had no auditable tab. | Opening a retained matched JE from full-page Bank evidence now freezes the bank account, bank item and any Receipt/Reconciliation origin. JE offers **Back to bank evidence**, restoring the exact bank item, whose own Back continues to the Receipt or reconciliation history when applicable. | PARTIAL — local return scope is unit-verified. QBO matching, bank-feed, posting, clearing, reconciliation, permissions/audit, browser history and responsive behavior remain unobserved; no auto-match, post, clear, sign-off or external connection is enabled. |
| Reconciliation → JE return | No fresh QBO Reconcile row, signed-history detail, matched-JE drill or Back interaction was available this cycle; the current browser bridge exposed no auditable tab. | JE actions from local Reconcile worksheet evidence and immutable signed-history detail now preserve bank account, focused bank item and signed-snapshot id. JE replaces the reconciliation surface and provides **Back to reconciliation**, reopening the exact worksheet or signed snapshot. | PARTIAL — local return contract is unit-verified. QBO reconcile workflow/history/undo, matching, clearing, sign-off, permissions, audit and responsive behavior remain unobserved; no reconcile state is modified by this drill. |

- Assistant3 business-fit guidance applied: retain entity/property-project/payment-account/POSTED JE/bank-evidence boundaries; no automatic match, review, posting or external receipt intake. `node verify-receipt-return-context.mjs`, `node verify-receipt-bank-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` must pass before this local interaction is treated as ready.

## Accounting — Account Register entry → JE retained return (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Account Register entry → JE return | No fresh QBO Account Register row/detail/JE drill was available this cycle because the browser bridge exposed no auditable tab. Earlier QBO evidence established Accounting navigation only; Register interaction remains unobserved. | The existing Account Register already limits rows to one entity, balance-sheet account, through-period and POSTED evidence. Its full-page entry detail now passes its exact account, cutoff and entry key to JE; JE shows **Back to account register** and reopens that same entry instead of appending the JE beneath the Register table. | PARTIAL — local scope contract is unit-verified. QBO register edit/delete/reconcile/history, filters, permissions/audit and responsive behavior remain unobserved; bank feeds, downloads, auto-match/post, external statements/OCR, payment/sales channels and export remain excluded. |
| Account Register entry → Reconcile return | No fresh QBO Register-to-Reconcile handoff or Back behavior was available this cycle; no QBO data was changed. | A selected local Register entry can now open its mapped local reconciliation scope with its exact register account, cutoff and entry key attached. Reconcile presents **Back to account register** and restores that entry, rather than returning to a generic Register table or appending reconciliation below the entry detail. | PARTIAL — local navigation is build/contract verified. QBO register/reconcile handoff, bank-feed, clearing/sign-off, permissions/audit and browser history remain unobserved; no match, clear, sign-off, external statement or connector action is enabled. |

- Assistant3 business-fit review applied: Register is the first Accounting P0 because it ties GL/TB/BS to bank/reconcile while isolating Operating, Restricted, Escrow/Trust and Loan-draw cash. `node verify-account-register-return.mjs`, `node verify-account-register-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` must pass before the local navigation contract is relied on.

## Accounting — Chart of Accounts business-fit shell (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Local Chart of Accounts scope and drills | No fresh QBO Chart of Accounts table/detail interaction was available this cycle because the browser bridge exposed no auditable tab. Previously observed QBO navigation/table controls are shell evidence only. | The local COA list now identifies Operating/Escrow/Restricted cash scope and AR/AP control accounts next to account type, balance and activity state. **View register** remains restricted to balance-sheet accounts and **Run report** to scoped GL detail. Account creation and activation/inactivation are visibly unavailable; no local COA state is changed. | PARTIAL — local classification/drill contracts are unit-verified. QBO New/Edit/Batch/Merge/Delete, account detail, limit/filter outcomes, permissions/audit and responsive behavior are unobserved; bank feeds, tax mapping, external export/sync, cross-company configuration, sales/payment channels and automatic accounting changes are excluded. |

- Assistant3 business-fit review applied: use only a real-estate COA with cash/control boundaries; preserve report/register return scope; never imply that local classifications are QBO configuration equivalence. `node verify-chart-account-actions.mjs`, `node verify-account-register-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` must pass before this local shell is relied on.

## Reports — report-to-GL-to-JE retained context (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Report drill / source / Journal Entry return | Prior QBO report-shell observation establishes report navigation only. No populated report row, JE/source drill, Back action or scope persistence was exercised in QBO, and no QBO data was changed. | Every local Reports-to-GL/JE drill now freezes selected entity, period, property, project, loan and cash scope in navigation context. JE, Bill/AP, Invoice/AR, Bank Transaction/Reconcile and source-document full-page drills all expose that retained scope beside **Back to report**; Back reconstructs the scoped report rather than appending transaction detail underneath it. Reconcile-originated report review carries its explicit cash account. | PARTIAL — local return contract is verified; QBO populated drill, browser history, permission and saved/custom report behavior remain unobserved and are not claimed. |
| Reports Center ledger launch | No QBO report selection, entity switch or back behavior was exercised in this cycle; the active QBO browser session currently exposes no controllable tab. | A direct Reports Center launch now freezes entity alongside the local 2026-01 to 2026-07 scope before opening GL/TB. The destination consumes this route entity rather than depending only on later global selection, so subsequent return/drill behavior keeps the originating statement scope. | PARTIAL — local route integrity is unit-verified; QBO entity-filter persistence and report navigation behavior remain unobserved. |
| Reference-only report selection | QBO Reports navigation had previously been observed, but no data-sync, connector, report content or action was opened during this cycle. | Selecting a reference-only name (including Data Sync Report and non-adopted WBS/external surfaces) now replaces the report list with an explicit unavailable page. It exposes no source rows and disables refresh/save/print/export; only approved local-preview reports may render local evidence. | PARTIAL — the business-fit exclusion is verified locally; QBO report contents and permissions are unobserved and not reproduced. |

- `node verify-report-business-scope.mjs`, `node verify-report-launch-context.mjs`, `node verify-report-return-context.mjs`, `node verify-report-workflow-return.mjs`, `node verify-report-workflow-targets.mjs`, `node verify-report-scope-empty-state.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

## Global shell and information architecture

| Area | QuickBooks evidence | REFS current state | Gap / required behavior | Grade |
|---|---|---|---|---|
| Navigation | Compact icon rail with Home, Reports, All apps, Bookmarks, Create and Customize surfaces | Expanded accounting tree | Preserve REFS domain depth while adding task-first shortcuts and compact visual hierarchy | OBSERVED |
| Search | One global field for navigation, transactions, contacts, help and reports | Route and JE search | Expand contract to cross-object results and categorized result types | OBSERVED |
| Create actions | Creation is separated from viewing and control surfaces | Global New menu exists | Match action grouping and avoid mixing destructive/write actions into read-only workspaces | OBSERVED |
| Home composition | User greeting, customizable cards, quick links and operational exceptions | Fixed dashboard cards | Add configurable card visibility/order and clearer exception-first prioritization | OBSERVED |
| Privacy | Dedicated privacy-mode control | Not equivalent | Add privacy masking for sensitive balances and names | OBSERVED |
| Workflow automation | Dedicated global workflow-automation entry | Batch/rule modules are distributed | Provide one automation center linking rules, schedules, approvals and run history | OBSERVED |

## Authenticated homepage capability map

| Capability | Observed behavior | REFS mapping | Gap |
|---|---|---|---|
| Accounting | Task shortcut into bank/accounting workspace | Auto Reconciliation, bank transactions, GL | Navigation and exception handoff need consolidation |
| Expenses & Pay Bills | Dedicated job workspace | AP workspace / payable evidence | Needs task-level funnel and due/approval controls |
| Sales & Get Paid | Dedicated sales and payment funnel | AR legacy/workspace | Needs end-to-end funnel and deposit linkage |
| Customer Hub | Separate customer work center | Master data / AR | Needs activity-centered customer detail |
| Team / Time / Payroll | Dedicated workforce surfaces | Not in core REFS scope | Mark optional unless accounting integration requires them |
| Projects / Inventory | Dedicated operational accounting workspaces | Project cost, CWIP, unit cost | Requires workflow-level parity assessment |
| Sales Tax / Lending | Dedicated compliance and financing workspaces | Loan register; no sales-tax equivalent | Lending mapping required; sales-tax scope decision required |
| Bank accounts card | Shows bank balance, book balance, freshness and attention state per account | Bank and reconciliation modules | Add unified account health card and freshness/attention contract |
| Profit & Loss card | Period selector, drill links and uncategorized-bank warning | Reports/GL | Add exception-aware report completeness state |
| Expense card | Period comparison and review queue | AP/Bank | Add comparative KPI plus unresolved transaction count |
| Audit activity | Direct activity/audit-log entry | Audit log exists | Link transaction audit and global audit consistently |

## Financial reporting and traceability

| Requirement | QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Statement amount drill-down | Report amount opens transaction detail | Balance Sheet and Income Statement account and total drill-down implemented | PARTIAL |
| Detail to transaction | Transaction-detail rows open source transaction | Detail rows route to corresponding JE | PARTIAL |
| Transaction audit history | Who, when and what changed; expanded/compare views | JE audit timeline exists but no side-by-side comparison | GAP |
| Source trace | QuickBooks transaction/account lineage | REFS adds WBS/AP/bank source trace | REFS-EXTENSION |
| Beginning-balance semantics | Balance Sheet drill includes cumulative beginning balance behavior | Current report uses activity range | GAP: accounting semantics must be corrected |

## Bank transactions workbench

| Capability | QuickBooks evidence | REFS mapping | Gap / status | Grade |
|---|---|---|---|---|
| Account health | Account selector exposes connection errors, attention state, data freshness, bank balance and posted/book balance | Bank Batch Pipeline and reconciliation metrics are distributed | Consolidate health, freshness and balance controls without exposing sensitive values | OBSERVED |
| Review state machine | Transactions are separated into Pending, Posted and Excluded queues | REFS has matching and reconciliation states but no single equivalent queue contract | Define guarded transitions, reversal behavior and audit requirements before claiming parity | OBSERVED |
| Review filters | Search, date and transaction-type filters are combined with pagination | Partial filters exist across bank pages | Unify filters and persist user view state | OBSERVED |
| Transaction grid | Date, bank description, spent/received, attachment, from/to, match-or-categorize and action columns | Current bank matching table covers only part of this context | Add missing review context and maintain horizontal readability at narrow widths | OBSERVED |
| Assistance | Per-row AI recommendation and conversation entry are available beside match/categorize | REFS has AI audit concepts, not equivalent per-row assistance | Keep advisory output explainable and auditable; never auto-post | OBSERVED |
| Output controls | Print, CSV export and table settings are available from the queue | CSV exists on selected REFS lists | Add consistent print/export/column-preference contract | OBSERVED |
| Register handoff | Selected bank account links to its bank register | Bank transaction and GL routes are separate | Provide bank-account → register → transaction → JE/source trace | OBSERVED |
| Connection remediation | Errors distinguish reconnect/fix/disconnect paths while preserving existing transactions | No proven equivalent connection-health workflow | Requires connector-specific state, permissions and non-destructive remediation evidence | OBSERVED |

## Discovery queue

1. Accounting / bank transaction review and categorization.
2. Reports center, standard reports, customization, saved reports and drill-down.
3. Expenses, bills, payments, vendors and approval behavior.
4. Sales, invoices, receipts, deposits, customers and credits.
5. Chart of accounts, registers, reconciliation and close.
6. Projects, inventory, lending and fixed-asset dependencies.
7. Global create menu, settings, users/roles, audit log and workflow automation.
8. Error, empty, loading, permission-denied and irreversible-action states.

## Non-equivalence rule

No QuickBooks capability is marked equivalent until its visible workflow, fields, states, drill-through, permissions, accounting result, reversal behavior and audit evidence are all verified in REFS.

## Read-only evidence — 2026-08-02

The signed-in QuickBooks session exposed the Accounting / Bank transactions workbench. Confirmed visible structure: account-health alert area; account selector cards with bank/book balances and freshness date; queues `Pending`, `Posted`, `Excluded`; Search, date and transaction-type filters; 1–50 pagination; Print, Export to CSV and Settings controls; and a review grid with Date, Bank description, Spent, Received, Attach file, From/To, Match/Categorize and Action columns. Rows also expose vendor/customer selection, category selection, AI suggestions, conversation entry and guarded Match/Categorize/Post actions. This is read-only observation only; no action was submitted.

The same view showed connection-health errors with distinct Report now, Fix now and disconnect paths. These remain OBSERVED and are not claimed equivalent in REFS.

REFS implementation update on August 2, 2026: the bank-transactions workspace now mirrors that QuickBooks evidence more closely with a dedicated selected-account summary band, explicit bank-versus-posted-versus-difference metrics, a source column, compact print/export/column controls inside the review toolbar, and row actions that preserve queue state instead of flattening the page into one generic table. This is an implementation update, not a parity claim.

## Read-only evidence - 2026-08-02, Balance Sheet detail

The signed-in QuickBooks Balance Sheet detail page was inspected without submitting any write actions. Confirmed visible report controls: Back to standard reports, Report period, From/To date inputs, Cash/Accrual accounting method, Display columns by, Select Period, Customize, Save As, Compact | 100%, refresh, Email, Print, Export, More actions, Insights, Company name, report name, sort direction and Add note.

The visible report body shows a statement hierarchy: company name, Balance Sheet title, as-of date, ready state, sections such as Assets / Current Assets / Bank Accounts, individual bank-account rows, a Total column and statement amounts. The inspected amount cells rendered as table cells / rowheaders rather than normal links or buttons in the visible DOM; a direct click confirmation of amount drill-down is still pending because the browser viewport call timed out. Therefore amount drill-down remains `PARTIAL`, not equivalent.

REFS implementation update on August 2, 2026: General Ledger report views now include a QuickBooks-style report builder toolbar with period, date range, accrual/cash, display columns, refresh, customize, save, compact, email, print, export, more and insights controls. Customize / More / Insights now open visible in-page panels instead of only emitting toast messages. Report drill-down now opens a transaction-detail report shell with Back to report, refresh/customize/export/print/more actions, report period, accounting method, debit/credit control totals, JE row navigation and source-workflow badges. This is an implementation update, not a parity claim.
## REFS implementation update — report workbench menu polish (2026-08-02)

- Report workbench now has persistent favorite state (`☆`/`★`) and a row-level More Options menu with Add to favorites, Preview, and Copy link actions.
- Menu is keyboard/visual-safe (anchored to action cell, bounded shadow, no table reflow) and remains read-only for accounting data.
- Build verification: esbuild bundle and `dist/index.html` copy completed successfully.
## REFS implementation update — Journal Entries workbench (2026-08-02)

- Journal Entries list now supports QuickBooks-style text search across JE number, description, payee and source, plus period/status/source filters and one-click clear.
- Added attachment evidence column (`Attached` / `Missing`) and preserved row-to-editor drilldown, approval/posting actions, source badges and JE detail dimensions.
- Responsive filter layout keeps search full-width on narrow screens to avoid clipped labels or wrapped controls.
## REFS implementation update — Journal Entry detail action bar (2026-08-02)

- Journal Entry detail now exposes a compact QuickBooks-style context bar showing edit/view mode, JE type and source system.
- Added read-only Audit history and Print preview entry points above the posting grid; existing workflow actions remain governed by permissions and JE state.
- Responsive behavior stacks the context and actions on narrow widths to avoid wrapped or clipped controls.
## REFS implementation update — report preview tools (2026-08-02)

- Report preview now has interactive Customize, More actions, and Insights panels instead of toast-only placeholders.
- Customize exposes visible-row/column toggles; More actions exposes audit trail, copy link, and note entry points; Insights exposes report readiness, drillability, and source-trace indicators.
- All controls remain non-destructive and preserve report → ledger → JE → source navigation.
## QuickBooks read-only evidence — authenticated homepage (2026-08-02)

- QuickBooks home exposes Main Navigation, Tools and Settings, Intuit account, Customize and Privacy mode controls.
- Quick links include Accounting, Expenses & Pay Bills, Sales & Get Paid, Customer Hub, Team, Time, Projects, Inventory, Sales Tax, Lending and Payroll.
- Create actions include Run payroll, Get paid online, Create invoice, Record expense and Add bank deposit; the home also presents Needs attention, sales funnel date window, suggestions and See all activity.
- REFS home quick links were expanded to mirror this product-level navigation while retaining REFS-specific Auto reconciliation, Reports and WBS workflows.
## Scope decision — QuickBooks shell priorities (2026-08-02)

- Primary shell modules are Reports, Accounting and Expenses.
- Added explicit Expenses and Accounting navigation groups to REFS, mapping Bills & Expenses, Bank transactions, Checks, Fixed assets, General Ledger, Journal Entries, Account register and Chart of Accounts to existing workflows.
- Sales/Customers/Team/Time/Projects/Inventory/Sales Tax/Lending/Payroll remain lightweight navigation shortcuts unless a WBS/AutoRec dependency is proven.
## REFS implementation update — Expenses workbench priority (2026-08-02)

- Bills & Expenses now has a QuickBooks-style search bar, status filter and clear action above the bill table.
- Filtering covers bill number, vendor and invoice number while preserving bill → detail → JE/source trace behavior.
- Responsive toolbar collapses the search field to a full-width row on narrow screens to avoid clipped controls.
## Scope sequencing decision (2026-08-02)

1. Establish QuickBooks-native shell parity first: Reports, Accounting, Expenses, navigation, tables, filters, detail pages, drill paths, permissions and audit affordances.
2. Add WBS/AutoRec localization as a second layer, preserving the native shell and exposing WBS-specific source, cost, project and reconciliation dimensions only where relevant.

Current REFS implementation contains both layers; any WBS-specific surface not yet backed by QuickBooks evidence remains explicitly non-equivalent until the native shell baseline is closed.
## REFS implementation update — Reports Center favorites semantics (2026-08-02)

- Favorites now filters by the actual user-selected favorite set rather than using the GL category as a proxy.
- The tab count reflects the selected favorites and remains compatible with search and report preview actions.
## REFS implementation update — Fixed Assets shell baseline (2026-08-02)

- Fixed Assets now has a QuickBooks-style page header, KPI summary, Assets/Depreciation/Disposals tabs, export entry point and asset-to-Balance-Sheet account drillback.
- Empty depreciation/disposal states are explicit; no WBS-specific behavior was added to this native shell surface.
## REFS implementation update — Reports Shortcuts curation (2026-08-02)

- Reports Center Shortcuts now mirrors a curated QuickBooks-style set: Balance Sheet, Income Statement, Trial Balance, Cost General Ledger and Payable Report.
- All reports, Favorites, WBS category and search remain available as separate scopes.

## QuickBooks read-only evidence & REFS update — Expenses transaction queue (2026-08-02)

- Authenticated QuickBooks Expenses exposes a New transaction entry point, Transaction Type selector, Filter action, date scope (default Last 12 months), Print, Excel export and table settings controls. The observed account showed an explicit empty state when no expenses match.
- REFS Bills & Expenses now adopts the verified queue controls that map to its bill data: Transaction type (all/open/paid), Dates (last 12 months/this month/all dates), Status, search, visible transaction count, Clear and a New transaction entry point.
- The New transaction entry currently opens REFS's existing bill workflow. QBO's other transaction forms, filter drawer fields, printing, Excel export behavior and empty-state wording are not asserted as equivalent.

## REFS implementation update — Fixed Assets register filters (2026-08-02)

- Fixed Assets register now has QuickBooks-style Search asset or account and Status filters with a Clear action.
- Filtered rows retain account drillback to Balance Sheet; empty results use an explicit no-match state.
- This is a shell enhancement only; depreciation schedules, disposal workflows and permissions remain unverified against QBO.

## AP/Expenses shell gap audit — 2026-08-02 (read-only code inspection)

- Bills is the most complete AP surface: search, transaction type/date/status filters, count/Clear/New transaction, bill list, detail drawer, approval SoD and JE timeline are present.
- Payments is currently an approved-bill selection and payment-run surface only; payment method/account/date, partial payment, void/undo, batch detail, print/export and audit behavior remain unverified.
- Aging currently exposes four KPI buckets for open bills but no detail rows, as-of control, vendor/date filters, drillback, totals or export/print behavior; QBO bucket semantics are not yet evidenced.
- Vendors currently renders a static table (code/name/related-party/1099/W-9). Search, pagination, detail/edit/create, status, audit and transaction drillback remain unverified.
- The authenticated QBO Expenses evidence currently supports New transaction, Transaction Type, Filter, Last 12 months, Print, Excel and settings controls; REFS has not claimed the unimplemented QBO Filter drawer, printing/export semantics or settings as equivalent.

## REFS implementation update — Expenses shell controls (2026-08-02)

- Bills toolbar now exposes read-only shell entry points for Filter, Print, Excel and Settings alongside the previously evidenced New transaction, Transaction Type and date controls.
- Filter opens a placeholder panel that preserves current inline filters; Settings exposes placeholder column toggles; Print/Excel are non-destructive preview/export-prepared notifications.
- These controls intentionally do not claim QBO field, export format, print output, settings persistence or Filter drawer equivalence until separately verified.

## REFS implementation update — AP Aging shell detail (2026-08-02)

- Aging now provides selectable All open bills and four local aging buckets, an explicit as-of label, bill count, detail rows and a no-open-bills empty state.
- Detail rows expose Bill number, vendor, due date, local bucket, amount and status; selecting a row returns to the existing Bills detail drawer.
- Bucket arithmetic is REFS-local and remains unverified against QuickBooks aging definitions, as-of behavior, permissions, export/print and audit semantics.

## Build integrity update — 2026-08-02

- Repaired malformed JSX/string literals in the WBS transaction and Integration Hub shell modules without changing any QuickBooks-derived parity claim.
- Validation was rerun after the repair. The build still fails on additional pre-existing malformed JSX in the same damaged source set; therefore no build-success or functional-equivalence status is asserted.
- Remaining compile gap: continue syntax repair before shell behavior can be verified in a built artifact.

## Build integrity update — 2026-08-02 (follow-up)

- Repaired malformed property-pickup journal-generation strings and the Integration Hub staging description/action cell.
- The subsequent build advanced past those locations but still fails on two later malformed JSX expressions (property pickup account cell and an AutoRec construction-status cell).
- Warnings also identify a duplicate table key and unescaped static arrows; neither is treated as a verified QuickBooks behavior.

## Build integrity update — 2026-08-02 (second follow-up)

- Repaired the property-pickup account display and Master Data project construction-status render cell.
- Build now reaches later syntax faults in the property-pickup balancing state and Master Data property definition. Build remains blocked; no parity status changed.

## Build integrity update — 2026-08-02 (third follow-up)

- Repaired the Master Data property table definition and replaced the malformed Property Pickup balance label.
- The parser still reports the balance area (its surrounding source remains damaged) and now reaches a separate Master Data explanatory paragraph. The build is not usable yet; all QuickBooks equivalence claims remain unchanged.

## Build integrity update — 2026-08-02 (fourth follow-up)

- Replaced malformed Closing Workspace metadata text and the Master Data explanatory paragraph with syntactically safe shell copy.
- Build advanced to a malformed Mapping Center rule definition; the Closing Workspace balance-area parse error persists despite the local label repair, indicating adjacent corruption.
- No new QuickBooks page evidence was captured in this repair-only pass.

## Build integrity update — 2026-08-02 (fifth follow-up)

- Reworked the Closing Workspace balance class expression to eliminate the previous template-literal parse site; the build progressed beyond it.
- Remaining hard errors are now a malformed Mapping Center capitalization rule row and a separate severity-filter chip expression. Build remains blocked and no functional-equivalence status changed.

## Build integrity update — 2026-08-02 (sixth follow-up)

- Repaired the Mapping Center capitalization rule row and converted the first severity-filter chip expression to a non-template class expression.
- Build advanced to the adjacent status-filter chip and a later Mapping Center rule expression. The app remains unbuildable; these are source-integrity repairs, not QuickBooks parity evidence.

## Build integrity update — 2026-08-02 (seventh follow-up)

- Repaired the Exception Center status-filter chips and Mapping Center charge-code mapping table expression.
- Build advanced to a later Exception Center template expression and a malformed Mapping Center action button. Build remains blocked; no new QBO evidence or equivalence claim was added.

## Build integrity update — 2026-08-02 (eighth follow-up)

- Repaired the close-task sign-off action cell and Mapping Center action button.
- Build now reaches a later unterminated Exception Center string and a Mapping Center explanatory paragraph/action boundary. It remains blocked; no QuickBooks behavior was inferred from these repairs.

## Build integrity update — 2026-08-02 (ninth follow-up)

- Replaced the Exception Center chart legend and Mapping Center section title with syntactically safe shell text.
- The same deeper EOF/paragraph-boundary errors persist, showing that adjacent damaged source remains. Build has not passed; no parity scope changed.

## Build integrity update — 2026-08-02 (tenth follow-up)

- Repaired the chart fallback text and Mapping Center heading/description boundary; build advanced through the Mapping Center component.
- Remaining errors are a deeper EOF string in the chart module and a malformed Rule Center array row. The artifact is still not buildable; no QBO parity claim changed.

## Build integrity update — 2026-08-02 (eleventh follow-up)

- Replaced the damaged intercompany rule row and simplified the doughnut-chart configuration to a syntactically safe shell implementation.
- Build now advances to the chart module EOF and Rule Center table expression. It remains blocked; no QuickBooks behavior or equivalence status was added.

## Build integrity update — 2026-08-02 (twelfth follow-up)

- Repaired the Rule Center guidance and table definition; compilation now advances beyond the prior Rule Center row error.
- Remaining parse faults are in a later Admin module list/paragraph boundary. Build still does not pass; no new QBO evidence or equivalence claim was recorded.

## Build integrity update — 2026-08-02 (thirteenth follow-up)

- Repaired the Admin SoD text/list boundary, reducing compilation to one remaining EOF string error in the chart helper area.
- Replaced the ExpDonut chart helper with a stable legend-only shell; the remaining error predates that helper and persists. Build is still blocked, so visual fidelity remains unverified.

## Build integrity update — 2026-08-02 (fourteenth follow-up)

- Replaced the entire damaged P&L chart helper with a minimal, parse-safe posted-entry shell. The compiler’s EOF location moved earlier in the same helper region, confirming further adjacent corruption.
- Build remains blocked by that one source-integrity error; no QBO evidence, behavioral implementation, or equivalence status changed.

## Build integrity update — 2026-08-02 (fifteenth follow-up)

- Repaired the period-close CTA title/copy and its adjacent workflow note. The single EOF error remains at the end of the module, indicating an earlier unclosed literal still needs isolation.
- Build is still not usable. No new QuickBooks evidence was captured and no unverified equivalence was claimed.

## Build integrity update — 2026-08-02 (sixteenth follow-up)

- Repaired the close-task Dependencies cell, removing another damaged JSX branch.
- The same single module-EOF error persists. No new QBO evidence was collected, and compilation remains the active blocker.

## Build integrity update — 2026-08-02 (seventeenth follow-up)

- Repaired the close-task Status column, another previously malformed literal in the EOF investigation area.
- The single EOF error persists after rebuilding. No QBO evidence or parity status changed; source-integrity repair remains the priority.

## Build integrity update — 2026-08-02 (eighteenth follow-up)

- Replaced the complete damaged Month-End Close render block with a parse-safe shell, preserving only REFS-local task fields and an explicitly shell-only close action.
- The EOF pointer moved earlier again, confirming corruption outside that render block. Build remains blocked; no equivalence claim changed.

## Build integrity update — 2026-08-02 (nineteenth follow-up)

- Repaired the Exception Center table empty-state literal while isolating the remaining EOF failure.
- Rebuild still reports the same single module-EOF error. No verified QBO evidence or parity claim was added.

## Build integrity update — 2026-08-02 (twentieth follow-up)

- Repaired three explicitly malformed Property Pickup status labels/coverage output cells. This removed the misleading EOF-only parser failure.
- The compiler now identifies a concrete malformed Property Pickup rule expression at line 384; build remains blocked. No new QBO evidence or equivalence status changed.

## Build integrity update — 2026-08-02 (twenty-first follow-up)

- Repaired the Property Pickup rule-status expression. Build advanced to an adjacent malformed security/exception note, whose unclosed span currently prevents parsing the following Closing Workspace function.
- No QBO read-only evidence was added; compilation remains blocked and no equivalence claim changed.

## Build integrity update — 2026-08-02 (twenty-second follow-up)

- Repaired the Property Pickup security-deposit exception note, allowing compilation to advance past the previously blocked Closing Workspace boundary.
- New concrete blockers are malformed Closing Workspace checklist labels and its explanatory paragraph. Build remains blocked; no QBO evidence or equivalence status changed.

## Build integrity update — 2026-08-02 (twenty-third follow-up)

- Repaired the Closing Workspace checklist labels and explanatory paragraph. Compilation now passes that component and identifies a concrete Exception Center initial-status string at line 427.
- Build remains blocked by that one malformed literal. No verified QBO evidence or equivalence status changed.

## Build integrity update — 2026-08-02 (twenty-fourth follow-up)

- Repaired the Exception Center initial status state to a safe ALL value. Compilation advanced to the next malformed exception-status filter expression.
- Build remains blocked; no QBO read-only evidence or equivalence status changed.

## Build integrity update — 2026-08-02 (twenty-fifth follow-up)

- Repaired the Exception Center severity/status filter expression. Compilation advanced to the next malformed exception-close notification at line 437.
- Build remains blocked; no QBO evidence or parity claim changed.

## Build integrity update — 2026-08-02 (twenty-sixth follow-up)

- Repaired exception-close validation and notification literals. Compilation advanced to a malformed Exception Center owner-column header at line 451.
- Build remains blocked; no QBO evidence or equivalence status changed.

## QuickBooks read-only evidence & REFS update — Home Create actions (2026-08-02)

- Authenticated QBO Home was observed with the Create actions labels Run payroll, Get paid online, Create invoice, Record expense, and Add bank deposit.
- REFS Dashboard now renders those five observed labels in a separately labelled `Create actions · REFS local routes` shell. Each opens only an existing REFS local module route; it does not submit, create, pay, deposit, or alter QuickBooks data.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 452.1kb). QBO create workflows, Show all expansion, permission gating, validation, transaction persistence, audit entries, and responsive behavior remain unverified and are not marked equivalent.

## Build integrity update — 2026-08-02 (twenty-eighth follow-up)

- Replaced the damaged Exception Center detail drawer with a parse-safe shell preserving severity, reference, root cause, resolution, and permission-gated close action.
- node build.mjs now succeeds and rebuilds dist/. Remaining warnings: two unescaped static arrows in Bank Transactions and one duplicate rowKey in a WBS transaction table.
- This validates compilation only. No new QuickBooks read-only evidence was captured, and no unverified feature is marked equivalent.

## Build hygiene update — 2026-08-02

- Escaped the two Bank Transactions drill-path arrows and removed the duplicate WBS table rowKey attribute.
- node build.mjs now succeeds without warnings and rebuilds dist/.
- This is build hygiene only; no new QuickBooks evidence or functional-equivalence claim was added.

## QuickBooks read-only evidence & REFS update — Expenses filter drawer (2026-08-02)

- Authenticated QBO Expenses currently exposes a Filter popover with Status (default All statuses), Delivery method (Any), Date (Last 12 months), From and To calendar inputs, Payee, Category, Apply, Reset, and Close. The empty queue remains visible behind the popover; Excel and Print are disabled with no matching expenses.
- REFS Bills Filter shell now represents each observed field and action. Only Status and Date are connected to the existing local bill filters; Delivery method, From/To, Payee, and Category are visibly disabled evidence fields.
- node build.mjs succeeds and rebuilds dist/. Filter result semantics, date/calendar logic, Payee/Category lookup, delivery-method behavior, and QBO permission/audit behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Expenses filter defaults (2026-08-02)

- The observed QBO filter popover currently displays From 08/01/2025 and To 08/31/2026 under Last 12 months.
- REFS now displays those observed values as disabled, read-only evidence fields; it does not claim date-range calculation equivalence.
- node build.mjs succeeds and rebuilds dist/. Navigation remained unexpanded because the active filter popover was preserved; no write action occurred.

## Evidence boundary update — Expenses filter (2026-08-02)

- Added a source annotation beside REFS Bills filter state identifying the observed QBO fields and explicitly constraining local filtering to Status and Date.
- node build.mjs succeeds and rebuilds dist/. No new QBO evidence was captured in this pass; browser navigation remained unavailable after read-only connection timeouts.

## QuickBooks read-only evidence & REFS update — Home navigation (2026-08-02)

- Authenticated QBO Home currently shows Welcome, Quick links (including Accounting and Expenses & Pay Bills), Create actions, Business at a glance, a Needs attention caught-up empty state, and a See all activity audit-log link. The expanded primary navigation lists Home, Reports, Accounting, Expenses, Sales, Customers, Team, Time, Projects, Inventory, Sales Tax, Lending, and Payroll.
- REFS Dashboard Quick links now uses the observed Expenses & Pay Bills label. Existing REFS links remain local route shells; their QBO destinations, permissions, action semantics, activity feed, and empty-state logic are not marked equivalent.
- node build.mjs succeeds and rebuilds dist/. This audit was read-only; no QBO action button or navigation destination was invoked.

## REFS implementation update — Home information architecture (2026-08-02)

- REFS Dashboard now mirrors the observed QBO Home section names Business at a glance and Needs attention.
- The REFS queue is explicitly labelled local because its task population and empty-state logic have not been verified as QuickBooks-equivalent. The observed QBO account was in an all-caught-up state.
- node build.mjs succeeds and rebuilds dist/. Browser navigation recovery remains pending; no QBO write action occurred.

## Build integrity update — 2026-08-02 (twenty-seventh follow-up)

- Repaired the Exception Center owner header. The parser advanced into its malformed detail drawer, where several damaged labels cause mismatched span/div closures.
- Build remains blocked; no QBO evidence or equivalence status changed.

## QuickBooks read-only evidence & REFS update — Home activity entry (2026-08-02)

- A fresh read-only QBO Home audit confirms that `See all activity` is a visible link to `/app/auditlog`; it appears below the caught-up Needs attention card.
- REFS Dashboard now exposes the observed `See all activity` label as a local route to its existing Audit Log shell. The route is view-only from the dashboard; no QBO navigation or data change was invoked.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 452.2kb). The QBO activity feed content, audit-event taxonomy, permissions, filtering, drill-downs, retention, and responsive layout are not yet observed and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Expenses navigation (2026-08-02)

- A fresh read-only QBO Home navigation audit expanded Expenses and observed its child navigation labels: Expense transactions, Vendors, Bills, Bill payments, Contractors, and 1099s. The click only expanded the navigation; QBO remained on Home and no data action occurred.
- REFS AP workspace now renders these six labels as an explicitly observed navigation shell above its local workspaces. Its coverage note limits current REFS behavior to local Bills, Payments, Aging, and Vendors views.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 452.7kb). The QBO destinations, tables, filtering, details, drilling, permissions, audit, empty states, and responsive behavior for all six child areas remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Expense transactions type filter (2026-08-02)

- Authenticated QBO Expense transactions was opened read-only. It currently shows Expenses, New transaction, Transaction Type, Filter, Dates: Last 12 months, disabled Export to excel and Print controls, Settings, and a No expenses found / change filters empty state. The Transaction Type list was opened without selecting anything and showed: All transactions, Expense, Bill, Bill payment, Check, Purchase order, Recently paid, Vendor credit, Item Receipt, and Expense (Receipt reminder). Print Checks, Purchase notifications, and a dismissible payroll promotion were also visible on this account.
- REFS Bills toolbar now mirrors the nine observed non-default QBO type labels alongside All transactions. Each non-default option is visibly disabled evidence-only; only the existing All transactions state remains connected, so REFS does not imply unverified cross-transaction filtering.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 452.7kb). QBO type-filter result semantics, option-specific columns, notice behavior, Print Checks, purchase notifications, promotion behavior, dates, settings, permission gating, auditing, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Expenses payroll promotion (2026-08-02)

- On the authenticated QBO Expense transactions page, Dates: Last 12 months remained pressed after a read-only click but no date-menu options were exposed, so no date option or date calculation is inferred. The same page visibly presents a dismissible payroll promotion: Ready to get same-day direct deposit?, explanatory same-day-pay copy, Explore payroll, and Close.
- REFS AP now renders the observed promotion copy in a local, dismissible shell. Its Close action only hides the local card for the current session; Explore payroll is deliberately disabled because the QBO payroll destination and eligibility behavior are unverified.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 453.6kb). QBO date-menu options, date calculation, promotion targeting, dismissal persistence, payroll navigation, eligibility, permissions, audit events, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Expense transaction columns (2026-08-02)

- A read-only click on QBO Expenses Settings opened a Columns popover. It shows checked Date, Type, No., Payee, Category, Total, and Bill Approval; unchecked Class, Location, Status, Method, Source, Memo, Due date, Balance, and Attachments; Rows is set to 50; and the popover has Close. No checkbox or row setting was changed.
- REFS Settings evidence shell now contains the full observed column list, those observed initial checked states, disabled Rows 50, and Close. These controls remain disabled evidence-only to avoid claiming unobserved column persistence or table transformations.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 454.0kb). QBO column toggling, row-density choices, setting persistence, table-column order/data values, permissions, audit, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Accounting / Bank transactions navigation (2026-08-02)

- Authenticated QBO Accounting → Bank transactions was read-only audited. Its expanded Accounting navigation lists Bank transactions, Integration transactions, Receipts, Reconcile, Rules, Chart of accounts, Recurring transactions, Revenue recognition, Fixed assets, Prepaid expenses, My accountant, and Intuit Experts. The page exposes an account-error alert, account cards, Pending/Posted/Excluded queues, search, All dates, Transaction types, pagination, Print, Export to CSV, Settings, and a table headed Date, Bank description, Spent, Received, Attach file, From/To, Match/Categorize, and Action. Pending rows visibly include attachment, conversation, AI suggestions, match/categorize, and post controls. No row action was invoked.
- REFS Bank transactions now renders the full observed Accounting navigation as an explicitly limited navigation shell above its local bank flow.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 454.6kb). QBO destinations, connection repair/disconnect flows, account-card data, queue semantics, filters, pagination, attachments, conversations, AI suggestions, categorization/matching/posting, export, settings, permissions, audit, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Bank connection error states (2026-08-02)

- A fresh read-only QBO Bank transactions audit confirms the alert distinguishes Error 355 (temporarily unable to retrieve data), Error 353 (account became unlinked), and Error 324 (account cannot be found). The Transaction types combobox remained All transactions; its options were not exposed because the read-only open attempt timed out, so none are inferred.
- REFS connection-health shell now names the three observed error states and explicitly says repair/disconnect behavior is not implemented.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 454.9kb). QBO report/fix/disconnect outcomes, transaction-type options and semantics, connection state persistence, permissions, audit events, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Home suggestions (2026-08-02)

- A fresh read-only QBO Home audit shows Suggestions for you with a TIP card, Smart Tip: workflows, copy about automated reminders, and Check it out; plus an ADD ON card, Automate your payroll in minutes, QuickBooks Workforce payroll copy, and Try free for 30 days. Main-navigation expansion again timed out before Reports could be reached, so no Reports evidence is inferred.
- REFS Dashboard now renders these two observed cards in a separately labelled suggestions shell. Both CTAs are disabled because their QBO destinations, eligibility, signup, and tracking behavior are unverified.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 455.7kb). Recommendation targeting, card ordering, CTA destinations, eligibility, enrollment, telemetry, permissions, audit, responsive behavior, and all Reports functionality remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Reports navigation (2026-08-03)

- A fresh read-only QBO Home navigation audit expanded Reports and observed these child navigation labels: Standard reports, Custom reports, Management reports, KPIs, Dashboards, Spreadsheet sync, Performance center, and Financial planning. The click only expanded navigation; QBO remained on Home and no business-data action occurred.
- REFS Reports Center now renders all eight labels in an explicitly observed navigation shell. Its coverage note makes clear that the existing local report workspaces are separate and do not establish destination-level equivalence.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 456.2kb). The eight QBO destinations, report catalogs, filtering, report detail, customisation, save/export/print behavior, drill-down, permissions, audit, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Expenses Expert Assisted offer (2026-08-03)

- A fresh read-only QBO Expense transactions audit shows the page title Expenses; Purchase notifications, Print Checks, New transaction, Transaction Type (All transactions), Filter, Dates: Last 12 months, disabled Export to excel and Print, Settings, and a No expenses found / change filters empty state. It also displays an Intuit Expert Assisted offer: Need extra help categorizing transactions?, a 30-day free-trial message, Learn more, and Close. No transaction, filter, or offer action was submitted.
- REFS AP now renders that observed Intuit Expert Assisted offer in its own dismissible local shell. Learn more is deliberately disabled; Close only hides the local card for the current session.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 457.2kb). QBO offer targeting, enrollment, eligibility, destination, persistence, tracking, permissions, audit, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Expenses purchase notifications (2026-08-03)

- A read-only click on QBO Purchase notifications opened an AI-powered receipt reminders for Mastercard dialog. It explains that a connected credit card and phone number receive a text link, then lists three steps: connect card and phone; receive the message after a card purchase; photograph and upload the receipt for Accounting Agent matching. The dialog contains No thanks, Purchase notifications, and Close. No card, phone number, receipt, or enrollment action was entered or submitted.
- REFS AP now exposes a Purchase notifications control and a local, dismissible evidence dialog with the observed title, explanatory text, three-step flow, No thanks, and Close. The local Purchase notifications confirmation remains disabled because enrolment behavior is unverified.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 458.5kb). Card/phone connection, SMS delivery, receipt uploads, agent matching, confirmation, eligibility, persistence, permissions, audit, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Expenses Print Checks setup (2026-08-03)

- A read-only QBO Print Checks interaction opened the Print checks setup surface. It shows steps 1 Print Sample, 2 Set up PDF Reader, and 3 Adjust Alignment. Step 1 defaults to Voucher (checked) with Standard as the alternate type, a View preview and print sample action, and an explicit note that setup preview uses sample rather than real cheque data. The surface also shows Cancel, No, continue setup, and Yes, I’m finished with setup. No choice was changed and no print, setup completion, or payment action was taken.
- REFS AP now has a Print Checks entry point and a non-mutating local setup shell containing the three observed steps, Voucher/Standard evidence state, the preview warning, and observed actions. All state-changing or print-related controls remain disabled; Cancel and Close only hide the local shell.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 460.3kb). QBO printer access, PDF-reader configuration, preview rendering, check-type persistence, alignment adjustment, setup completion, printing, permissions, audit, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Accounting navigation / Chart of accounts handoff (2026-08-03)

- A read-only QBO Accounting navigation expansion exposed Bank transactions, Integration transactions, Receipts, Reconcile, Rules, Chart of accounts, and Recurring transactions. Chart of accounts was selected only to navigate; the browser connection then ceased exposing the tab before its page contents could be inspected. No accounting record, filter, setup, export, or row action was changed.
- REFS Chart of Accounts now carries this observed seven-item Accounting navigation shell and a coverage boundary. No Chart-of-accounts table control, status, detail, drill-through, permission, audit, empty-state, or responsive behavior is claimed from this handoff.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 460.9kb). QBO Chart of accounts page information architecture and all of its functional behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Chart of accounts list shell (2026-08-03)

- A fresh read-only QBO Chart of accounts audit confirms: All lists, Run report, New account, an Intuit Expert Assisted trial card, Batch actions, Filter by name or number, Filter by limit (All), Batch edit, Export chart of accounts, Print, Settings, pagination showing 1–200, and a 200-account status. The table columns are Select all accounts, Name, Account type, QuickBooks balance, Bank balance, and Action. Visible rows expose selection checkboxes and context-sensitive View register or Run report actions. No account, filter, batch action, report, export, print, setting, or row action was changed.
- REFS Chart of Accounts now exposes the observed toolbar shell and a functional local name-or-number filter across its WBS and entity account tables. Limit, batch actions, batch edit, export, print, settings, New account, Run report, row actions, balances, and pagination remain evidence-only / disabled where they would imply QBO behavior.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 462.4kb). QBO search semantics, limit options, selection state, sorting, page navigation, account forms, action-menu outcomes, register/report destinations, permission gates, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Standard reports smart-reporting shortcut (2026-08-03)

- A read-only navigation to QBO Reports → Standard reports shows Create new report; a Smart Tip: smart reporting card describing smart reporting and customizable dashboards in Advanced; and a Shortcuts panel whose Performance center copy says users can view and create custom charts, with View dashboard. Visible Favorites include Accounts receivable aging summary, Balance Sheet, and Profit and Loss, each with a pressed favorite control and More Options. No report, favorite, dashboard, create, or menu action was changed.
- REFS Reports Center now renders the observed smart-reporting / Performance center shell alongside the existing report workspace. Check out smart reporting and View dashboard are deliberately disabled because their QBO destinations and behavior have not been verified.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 463.2kb). Create-report flow, tip eligibility, chart/dashboard configuration, favorite state, More Options, report list coverage, report drill-through, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Standard reports Favorites evidence (2026-08-03)

- A fresh read-only Standard reports audit confirms a Favorites list containing Accounts receivable aging summary, Balance Sheet, and Profit and Loss. Each visible item has a pressed Favorite control and a More Options control. No favorite state or menu action was changed.
- REFS now renders this observed three-item Favorites evidence shell with pressed, disabled favorite and More Options affordances. This does not change REFS's own local report-workbench favorites behavior.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 464.0kb). QBO favorite persistence, sorting, eligibility, menu content, report destinations, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Management reports list shell (2026-08-03)

- A fresh read-only QBO Management reports audit exposes Switch to legacy management reports, Drafts, Published, Filters, Search, and resizable Name, Created by, and Last modified columns. The inspected state exposed neither report rows nor an empty state, so neither is inferred. No report, mode, filter, search, tab, or column operation was changed.
- REFS Reports Center now carries this limited Management reports shell with the observed tabs, controls, and column labels. All controls are disabled, explicitly avoiding an unsupported claim about report or filter behavior.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 465.5kb). Legacy-mode behavior, draft/published contents, filters, search semantics, column resizing, row actions, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Management reports Published empty state (2026-08-03)

- A read-only selection of QBO Management reports → Published showed + Create report, Published as the active tab, Filters, Search, resizable Name / Published by / Published on / Reporting period / Actions columns, the empty state No management reports yet / After you create a report, you'll see it here., and disabled pagination at 0–0 of 0 items, Page 1 of 1. No report was created, published, edited, or deleted.
- REFS now renders that observed Published empty-state shell, its five columns, Create report affordance, and zero-result pagination as disabled evidence controls.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 466.1kb). Create/publish workflow, draft state, filters, search semantics, pagination, column resizing, actions, permissions, audit events, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Management reports Drafts state (2026-08-03)

- A read-only QBO selection of Management reports → Drafts showed Drafts active, + Create report, Filters, Search, and resizable Name / Created by / Last modified / Reporting period / Scheduled / Actions columns. The observed table exposed blank placeholder cells and pagination at 0–0 of 0 items, Page 1 of 1; it did not expose a textual empty-state message. No report was created, edited, scheduled, published, or deleted.
- REFS now makes its observed Management reports evidence shell locally switchable between Drafts and Published. The Drafts state exposes the six observed columns and describes only the observed blank-placeholder condition; it does not invent a QBO empty-state message.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 466.2kb). Create/edit/schedule/publish behavior, draft content, filters, search semantics, pagination, column resizing, actions, permissions, audit events, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Custom reports list shell (2026-08-03)

- A fresh read-only QBO Custom reports audit shows a report-name search combobox, Create new report, and columns Report name, Created by, Last Modified By, Date range, Access, Email, and Action. Visible rows include Transaction Drilldown Report and two Transaction Report entries, with visible BIN WAN, Customized and/or Shared text, Edit, and Expand Menu. Pagination reads First, Previous, 1–3, Next, Last. No report, edit, menu, search, or create action was used.
- REFS Reports Center now renders the observed Custom reports list shell, three visible report-name instances, column labels, disabled Edit / Expand Menu, and the observed pagination affordances.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 468.1kb). QBO report data, dates, owner, access, email, Edit/menu outcomes, create flow, search semantics, pagination behavior, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Transaction Drilldown Report shell (2026-08-03)

- A read-only drill from QBO Custom reports opened Transaction Drilldown Report. Visible controls include Back to reports, Report period set to Custom dates, From and To date inputs with a From Calendar button, Customize, Save plus its menu, a collapsed control, PIVOT, CHART, Compact | 100%, and sortable Transaction date, Transaction type, and Num columns. No dates, settings, save state, layout, pivot/chart state, sorting, or report row were changed.
- REFS Reports Center now renders this observed read-only drilldown-report toolbar and its three observed sortable column labels. State-changing and outcome-dependent controls are disabled.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 469.7kb). Report data and dates, period options, calendar behavior, customization/save outcomes, pivot/chart behavior, compact mode, sorting, drill-through, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Transaction Drilldown toolbar and columns (2026-08-03)

- A targeted read-only DOM audit of the open Transaction Drilldown Report additionally confirms From Calendar, To Calendar, refresh report, Email, Print, Export, More actions, Company name, Enter report name, and Add note. Its table also exposes Name, Description, Account full name, Item split account, Amount, and Balance after Transaction date, Transaction type, and Num. No button, field, sorting control, or row was changed.
- REFS now extends the drilldown shell with these 10 observed toolbar controls and all 9 observed column labels; each outcome-dependent control remains disabled.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 470.5kb). Calendar values, refresh, email, print, export, more actions, company/report naming, notes, sorting, report data, drill-through, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — KPIs list shell (2026-08-03)

- A read-only QBO Reports → KPIs audit shows Create KPI, Filters, Search, Refresh, Export, Customize, KPI name / Last month / Previous period columns, and visible View rows for Revenue, Cost of Goods Sold, Number of Invoices, and Value of Invoices. No KPI, filter, search, refresh, export, customization, or View action was invoked.
- REFS Reports Center now carries the observed KPI list shell, controls, columns, and four visible row labels. All controls that require QBO outcomes remain disabled.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 472.2kb). KPI calculation and values, groups, filters, search, refresh, export, customization, View destinations, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Dashboards / KPI Scorecard groups (2026-08-03)

- A read-only QBO Reports → Dashboards audit opened KPI Scorecard. It shows Create KPI, Manage scorecard, Filters, Search, refresh, Export, Settings, a comparison table with KPI name, Last month, Previous period, Variance, Variance %, Action, and View / Expand Menu. Observed groups are Finance – Growth, Finance – Profitability, Finance – Cash Flow, and Sales – Growth, with visible KPI labels including Revenue, costs, profit/margin, cash-flow, customer, contact and sales measures. No KPI, scorecard, filter, search, refresh, export, setting, grouping, View, or menu action was changed.
- REFS now extends its KPI shell into the observed KPI Scorecard grouping structure, comparison columns, scorecard control, and disabled View / Expand Menu affordances. It intentionally does not reproduce live business values.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 473.0kb). KPI values/calculation, date labels, group expand/collapse, scorecard management, filters, search, refresh, export, settings, View/menu outcomes, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Dashboards library (2026-08-03)

- A fresh read-only QBO Dashboards audit shows Create dashboard, Search by dashboard name, Favorites, and All dashboards. Visible Standard thumbnails include Profitability, Cash flow, Balance Sheet, Accounts Receivable, Accounts Payable, and Revenue. Sales performance is visible with Connect data source. No dashboard, favorite, search query, menu, data source, or card destination was changed.
- REFS Reports Center now carries this dashboard-library shell with the observed groups, labels, and disabled Create dashboard / Connect data source controls. Its dashboard-name search filters the local evidence cards only.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 474.9kb). QBO dashboard thumbnails, favorites and menus, dashboard creation, source connection, search semantics, card destinations, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Spreadsheet Sync introduction (2026-08-03)

- A fresh read-only QBO Reports → Spreadsheet sync audit shows Get deeper insights with Spreadsheet Sync, copy about secure QuickBooks Online Advanced/spreadsheet data exchange, Create reports the way you want, A 2-way sync, Run multi-company reports in spreadsheets, Run report in Excel, Run report in Google Sheets, and Video tutorials. No spreadsheet was connected, no report was run, and no bulk edit or sync was initiated.
- REFS Reports Center now carries this observed Spreadsheet Sync introduction shell. Excel, Google Sheets, and tutorial actions are disabled to avoid unsupported data-transfer or external-navigation behavior.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 476.5kb). Spreadsheet connection, two-way sync, bulk edits, multi-company reports, Excel/Google Sheets execution, tutorial behavior, permissions, audit events, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Performance center cards and access states (2026-08-03)

- A fresh read-only QBO Performance center audit shows Customize Layout; Accounts Receivable and Accounts Payable aging-period cards with As of today, total amount, and Current through >6 months buckets; Expenses by time and Revenue by time with This year to date; plus permission-denied cards for Gross Profit by Time, Net Profit by Time, Cash Flow, Current Ratio by Time, Quick Ratio by Time, NPM vs Industry Benchmarks, and GPM vs Industry Benchmarks. No layout, period, or data action was changed.
- REFS Reports Center now renders this Performance center structure: aging/time card labels and the observed no-access message. Customize Layout and all data-dependent behavior remain unavailable.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 478.5kb). Layout editing, aging values, period options, chart data, access calculation, permission roles, audit, empty states, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Financial planning / Cash flow planner introduction (2026-08-03)

- A read-only expansion of Financial planning exposed Cash flow planner. Its QBO welcome page shows Become a cash flow pro, money-in/money-out guidance, See how it works, real-time cash-flow visibility, future inflow/outflow planning from past trends and patterns, scenario exploration without touching books, and Start planning. No planner was started and no scenario or book data was changed.
- REFS Reports Center now renders this observed Cash flow planner introduction with all outcome-dependent actions disabled.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 479.7kb). Cash-flow calculation, historical trends, scenario inputs, planner setup/preview, permissions, audit events, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Reconcile introduction (2026-08-03)

- A fresh read-only QBO Accounting → Reconcile audit shows Match the books to the bank records, Connected accounts are easier to reconcile, Connect now, Video tutorials (7:48), Keep yourself on track, Find holes in your accounting, Get things tidy for tax time, and Get started. No account was connected and no reconciliation was started or changed.
- REFS Bank Reconciliation now renders this observed QBO introductory shell above its existing local reconciliation workbench. Connect now, Video tutorials, and Get started are disabled evidence controls.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 480.9kb). QBO account connection, onboarding, reconciliation selection/setup, tutorial playback, permissions, audit events, empty states, and responsive behavior remain unverified and are not marked equivalent.

## Build blocker fix & QuickBooks read-only evidence — Accounting Rules (2026-08-03)

- Build was temporarily blocked by a syntax error in `src/ai-accounting.js`: the finding-risk sort expression had an unmatched parenthesis. The comparator now deterministically sorts by HIGH/MEDIUM/LOW risk rank, then confidence; `node build.mjs` succeeds again (bundle 495.4kb).
- A fresh read-only QBO Accounting → Rules audit shows New rule, Bank rules / Integration rules, Search rules by name or conditions, All rules status filter, Settings, and a table with drag-to-reorder, selection, Priority, Rule name, Applied to, Conditions, Settings, Auto-post, Status, and Actions. Visible rows expose Active, Edit, and Expand Menu, but their real business rules were not copied or changed.
- REFS Accounting Rule Center now renders the observed Rules shell and column structure, while keeping creation, tabs, search, filtering, settings, ordering, selection, edit, menus, auto-post, rule contents, permissions, audit events, empty states, and responsive behavior unverified and not marked equivalent.

## Scope decision & QuickBooks read-only evidence — Integration transactions and Receipts (2026-08-03)

- QBO Accounting → Integration transactions was read-only inspected. It presents sales-channel connectors (including Amazon, Shopify, PayPal, Squarespace, Square, Wix, Etsy, eBay, WooCommerce, and BigCommerce) with Learn more / Connect free integration. Per current product direction, sales-channel integration functionality is explicitly out of REFS scope; no connector code was added and no integration was connected.
- A fresh read-only QBO Accounting → Receipts audit shows Upload receipts, multi-receipt autofill and forwarding guidance, drag-and-drop support for PDF/PNG/JPEG/HEIC, For review / Reviewed tabs, Filter, Export, Customize, columns for receipt/reviewer/date/vendor/payment account/amount-tax/category/action, and an empty state with 0–0 of 0 items. No file was uploaded, forwarded, reviewed, exported, or turned into a bill/expense.
- REFS Bank Transactions now renders the observed Receipts capture-list and empty-state shell without the company forwarding address. Upload, forwarding, autofill, review, bill/expense creation, filters, export, customization, row actions, permissions, audit events, and responsive behavior remain unverified and are not marked equivalent.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 500.1kb).
## AI Accounting Brain implementation baseline (2026-08-03)

- Added `src/ai-accounting.js` with a skill registry, confidence review bands, immutable finding contract, and deterministic checks for duplicate payables/payments, missing source data, prepaid insurance coverage, unmatched bank transactions, JE balance, closed periods, loan draw classification and missing manual-JE attachments.
- Integrated deterministic findings into AI Audit Center as a separate Brain findings table; existing audit workflow and JE state machine remain authoritative.
- Added `outputs/AI-ACCOUNTING-BRAIN-DESIGN.md` documenting data contracts, review gates and remaining gaps.
- This is a local deterministic proposal layer, not a claim of 50-year accountant equivalence. Coverage extraction, amortization schedules, accrual schedules, persistent rule results, server-side permissions and production source schemas remain open.
## AI Accounting Brain workbench update (2026-08-03)

- Added Amortization Center: prepaid-like candidate queue, coverage-period gate, schedule table, remaining balance and permissioned Draft JE preparation.
- Added Accrual Center: month-end checklist and reversal placeholder with explicit source-evidence gate.
- These are controlled local proposal surfaces; no automatic posting or claim of production accounting equivalence.
## AI Accounting Analysis Report update (2026-08-03)

- Added Accounting Analysis Report with posted JE volume, open high-risk exceptions, controller action list, owner/priority and review actions.
- Report explicitly separates posted totals from draft/proposed/exception items and preserves the human-review boundary.

## REFS implementation update — Bank categorize to GL/TB bridge (2026-08-03)

- Local Bank Transactions Categorize now creates a posted `BANK` source JE for the evidence-backed fee and interest suggestions, so those category actions flow through the existing GL/TB report inputs instead of only changing the bank-queue display.
- Undo Categorize reverses the generated JE and retains a local audit event; it does not delete the original accounting evidence. This is REFS-local behavior, not a claim that QBO’s unobserved undo semantics are equivalent.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 501.0kb). Browser-refresh persistence and a selectable/manual-match source-JE workflow were not runtime-verified; receipt intake remains an evidence-only shell and sales-channel integrations remain out of scope.

## QuickBooks read-only evidence & REFS update — Receipts and Bill payments queues (2026-08-03)

- A fresh read-only QBO Receipts audit confirms Upload receipts and Upload from this device, drag/drop guidance (PDF/PNG/JPEG/HEIC), For review / Reviewed tabs, Filter, Export, Customize, the receipt/reviewer/date/vendor/payment-account/amount-tax/category/action table, sortable Date/Vendor/Amount-tax columns, and an empty 0–0-of-0 pagination state. No receipt was uploaded, forwarded, filtered, exported, customized, sorted, or reviewed.
- A fresh read-only QBO Expenses → Bill payments audit shows the Bill payments heading, an information control stating that the page only displays QuickBooks Bill Pay payments, Pending approval / Payments tabs, Filters, and Payment date: All dates. Its list continued loading, so payment table columns, row actions, settlement states, and filters beyond the visible control are not asserted.
- REFS AP Payments now has the observed queue labels and date control; Pending approval drills to the local bill, Payments exposes local AP payment evidence and its JE drill, and a new local payment records date/method/account plus `PAY_BILL` audit metadata. This is REFS-local AP workflow behavior, not verified QuickBooks Bill Pay/network equivalence.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 504.4kb). Receipt upload/autofill/review and QBO Bill Pay eligibility, approval rules, payment methods, settlement, cancellation, permissions, audit, and responsive behavior remain unverified; sales functionality remains out of scope.

## QuickBooks read-only evidence & REFS update — Bank transaction matching source selection (2026-08-03)

- A fresh read-only QBO Accounting → Bank transactions audit shows connected-account cards with Bank/Posted balances and update dates, selected-account error state, Pending/Posted/Excluded queues, Search, All dates, Transaction types, pagination, Print, Export to CSV, Settings, and columns Date, Bank description, Spent, Received, Attach file, From/To, Match/Categorize, and Action. Visible pending rows expose attachments, AI suggestions, counterparty/category suggestions, separate Match/Categorize controls, and Post; none was invoked.
- REFS Match now opens a local existing-record picker rather than assigning a placeholder. It admits only posted JEs whose cash impact equals the bank row amount and direction, writes the JE number to the match/audit record, and exposes the JE from the Posted queue; Undo returns the bank item to Review without deleting source evidence.
- The current local unmatched fixture has no exact posted cash JE, so the picker correctly presents its no-eligible-source empty state. This proves the mismatch guard, but a positive matching scenario remains manual-UI-unverified.

## QuickBooks read-only evidence & REFS update — Reconcile sign-off evidence (2026-08-03)

- A fresh read-only QBO Accounting → Reconcile audit again presents the introductory state: Match the books to the bank records, Connected accounts are easier to reconcile, Connect now, Video tutorials (7:48), Keep yourself on track, Find holes in your accounting, Get things tidy for tax time, and Get started. No connection, account selection, setup, or reconciliation was started.
- REFS local reconciliation now independently rejects sign-off unless adjusted balances agree and no bank activity is unmatched, emits `SIGN_OFF` audit metadata on success, stores the reconciled bank-item count, and provides Bank/GL drill actions from reconciliation history. Its in-workbench Match now routes to the exact-source-JE picker rather than creating a placeholder match.
- `node build.mjs` succeeds and rebuilds `dist/` (bundle 507.7kb). QBO reconciliation account selection, statement entry, transaction-clearing controls, completion report, undo, permissions, and audit semantics remain unverified and are not marked equivalent.

## REFS verification update — Exact bank-match candidate gate (2026-08-03)

- The read-only QBO Reconcile page remains in its introduction state; Connect now and Get started were not invoked. No new QBO reconciliation workflow semantics were inferred from that state.
- REFS bank-match eligibility is now a testable frontend function: only posted JEs with the same signed 111000 cash impact can be offered. The existing 46,000 rent-receipt fixture is accepted; the same JE is rejected for opposite direction and for a one-dollar mismatch.
- `node verify-bank-matching.mjs` and `node build.mjs` both succeed (bundle 507.7kb). `npm run test:bank-match` is blocked only by the local PowerShell execution policy on `npm.ps1`; direct Node execution is the recorded verification path.
## Accounting AI safety update (2026-08-03)

- Added decision-evidence, secret-redaction, AI-event and Draft-only proposal primitives to `src/ai-accounting.js`.
- Added `outputs/assistant2-ai-safety-check.ps1`; build and safety gate pass 5/5.
- AI still cannot atomically persist events/JE proposals across tabs or recover a server-side WAL; those remain explicit P1 gaps.
## Accounting AI WAL/recovery update (2026-08-03)

- Added AI WAL record and recovery primitives with idempotency keys, reuse of existing Draft JE, correlated recovery events and forced Draft status.
- AI safety gate now passes 7/7; this remains an in-memory/local contract until server-side WAL persistence and cross-tab locking are implemented.

## REFS local runtime verification — Bill-payment persistence (2026-08-03)

- QBO Accounting → Reconcile was re-read in its introductory state only: Match the books to the bank records, Connected accounts are easier to reconcile, Connect now, Video tutorials (7:48), Keep yourself on track, Find holes in your accounting, Get things tidy for tax time, and Get started. No connection, setup, account selection, or reconciliation action was invoked.
- In local REFS preview, an approved bill `BILL-2026-9002` was paid from the AP payment run. Its retained local evidence was `PAID`, payment date `2026-07-31`, method `ACH`, amount `$185,000.00`, and generated payment JE `20260731009715`; after a full browser refresh and returning to Expenses & Pay Bills, both the PAID bill row and the payment-history record remained visible.
- This verifies only REFS-local browser-refresh persistence of the existing payment flow. It does not generate a bank-feed item and does not prove QBO Bill Pay, bank matching, reconciliation sign-off, GL/TB computation, permissions, or audit equivalence.
- `node verify-bank-matching.mjs` and `node build.mjs` both exit 0; the rebuilt local bundle is 507.7kb. The Node module-type warning is non-blocking and remains unrelated to this functional check.

## REFS implementation update — Reconcile sign-off state gate (2026-08-03)

- The current QBO Reconcile tab was read-only audited again. It remains the onboarding surface with Match the books to the bank records, Connected accounts are easier to reconcile, Connect now, Video tutorials (7:48), three benefit bullets, and Get started. No QBO account, reconciliation, or statement action was invoked; this screen does not establish completion or undo semantics.
- REFS now has a shared local reconciliation-status contract used by both the action and worksheet UI. It blocks sign-off for unmatched activity, non-zero difference, and a duplicate account/period/statement sign-off; after a local sign-off the worksheet exposes the signer/time state and disables a duplicate action. This is a front-end functional guard and does not change ledger/posting-kernel behavior.
- `node verify-bank-reconciliation.mjs`, `node verify-bank-matching.mjs`, and `node build.mjs` all exit 0 (bundle 508.6kb). Browser UI replay could not be performed because this desktop browser blocks local preview navigation (`ERR_BLOCKED_BY_CLIENT`); QBO reconciliation workflow, completion report, undo, permissions, audit semantics, responsive behavior, and all QBO equivalence remain unverified.

## QuickBooks read-only evidence & REFS update — Expenses empty list controls (2026-08-03)

- A fresh read-only QBO Expenses audit shows the page heading; Give feedback, Purchase notifications, Print Checks, and New transaction; Transaction Type set to All transactions; Filter; Dates set to Last 12 months; Settings; disabled Export to excel and Print; and the empty state No expenses found / Try to change some filters to see more results. No filter, transaction creation, print, export, settings, notification, or feedback control was invoked.
- REFS Expenses now makes its local `All transactions`, `Bills — local evidence`, and `Bill payments — local evidence` selector functional. It intersects that selector with existing date, status, and search controls; unsupported transaction types remain visibly disabled. The local result table and count use the resulting evidence set.
- `node verify-expense-listing.mjs` and `node build.mjs` both exit 0 (bundle 509.0kb). QBO transaction-type values/semantics, filter panel fields, date presets, print/export enablement, settings, notification behavior, empty-state transitions, permissions, audit, and responsive behavior remain unverified and are not marked equivalent.

## QuickBooks read-only evidence & REFS update — Expenses filter panel (2026-08-03)

- The QBO Expenses Filter popover was opened and read only, then closed without changing any values. It exposes Status (All statuses), Delivery method (Any), Date (Last 12 months), From and To date textboxes with calendar controls, Payee, Category, Apply, Reset, and Close. The underlying list remained in the observed empty state.
- REFS now filters its local bill/payment evidence by custom From/To date, Payee, and Category in addition to existing transaction type, preset date, status, and query. Delivery method remains disabled and explicitly unverified because the current local bill evidence does not establish an observed QBO delivery-method contract.
- `node verify-expense-listing.mjs` and `node build.mjs` both exit 0 (bundle 509.9kb). QBO field option values, Apply/Reset semantics, calendar behavior, delivery method, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Expenses column settings (2026-08-03)

- A fresh read-only QBO Expenses Settings audit shows the Columns group: Date, Type, No., Payee, Class, Location, Status, Method, Source, Category, Memo, Due date, Balance, Total, Attachments, and Bill Approval; visible defaults are checked for Date, Type, No., Payee, Category, Total, and Bill Approval. It also exposes Rows set to 50. No checkbox or rows value was changed.
- REFS Settings now toggles the locally evidence-backed columns Date, Type, No., Payee, Category, Due date, Total, and Bill Approval in its bill/payment evidence table, persists those choices only in the local browser, and provides Restore local defaults. The other observed fields and Rows stay unavailable because the local dataset/table does not establish their behavior.
- `node verify-expense-listing.mjs` and `node build.mjs` both exit 0 (bundle 510.9kb). QBO column persistence, rows/pagination, unsupported column semantics, filter/column interaction, print/export, permissions, audit, empty-state transitions, responsive behavior, and equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Chart of Accounts list and drills (2026-08-03)

- A fresh QBO Accounting → Chart of accounts audit shows All lists, Run report, New account, Batch actions, Filter by name or number, Filter by limit: All, Batch edit, Export chart of accounts, Print, Settings, pagination (1–200 with Next), and Showing accounts 1 to 200. The table headers are selection, Name, Account type, QuickBooks balance, Bank balance, and Action. Visible bank rows expose View register; visible non-bank rows expose Run report. No account, selection, batch action, export, print, settings, report, or row action was invoked.
- REFS Chart of Accounts now uses that observed action split as a local drill: balance-sheet accounts open the existing Account Register with the selected code; profit-and-loss accounts open existing GL Detail scoped to the selected account. Existing active/inactive controls remain local and separate from QBO row menus.
- `node verify-chart-account-actions.mjs` and `node build.mjs` both exit 0 (bundle 511.5kb). QBO account subtype behavior, actual balances, selection/batch edit, account creation, pagination, settings, export/print, action menus, permissions, audit, empty states, responsive behavior, and equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Reports Center favorites (2026-08-03)

- A fresh QBO Reports Center audit shows an unnamed report-search combobox, Create new report and its menu, a Smart reporting tip, a Financial Summary for June with Review Summary, Shortcuts/Performance center, and Favorites. Visible QBO favorite report links are Accounts receivable aging summary, Balance Sheet, and Profit and Loss; each visible favorite control is pressed and has More Options. No report, favorite, menu, summary, dashboard, or create action was invoked.
- REFS Reports Center now persists its own local report-favorite names in the browser and restores only names that still exist in its local report catalog. Existing star/More Options affordances continue to operate on this local state; this does not claim parity with QBO favorites or its menu behavior.
- `node verify-report-favorites.mjs` and `node build.mjs` both exit 0 (bundle 511.9kb). QBO report search semantics, smart-summary content, favorite default set/persistence/menu actions, performance-center access, report creation, permissions, audit, empty states, responsive behavior, and equivalence remain unverified and are not claimed.
## Accounting AI Draft trace gate (2026-08-03)

- Extended AI safety test to require Draft JE trace fields: `ai_rule_id`, `ai_confidence`, `ai_evidence`, and `AI_PROPOSE_DRAFT` history.
- Build and static AI gate pass 8/8; server-side atomic persistence remains open.

## QuickBooks read-only evidence & REFS update — Accounting Rules search (2026-08-03)

- The authenticated QBO navigation was opened read-only and exposes Bank transactions, Reconcile, and Rules. The Rules control was located, but its click exceeded the browser selector deadline, so no newer Rules-page behavior is inferred from this attempt. The earlier recorded Rules list evidence remains the source for the observed search label and list shell.
- REFS Accounting Rule Center now searches only its locally controlled rule-shell records by rule id, trigger, posting-logic text, or local status and renders an explicit no-results state. It neither queries nor edits QBO and does not apply, create, reorder, edit, auto-post, or alter ledger/posting rules.
- `node verify-accounting-rule-listing.mjs`, `node verify-bank-matching.mjs`, `node verify-bank-reconciliation.mjs`, and `node build.mjs` all exit 0 (bundle 510.7kb). QBO search matching, tabs, statuses, settings, priority ordering, selection, actions, permissions, audit, empty-state semantics, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Bank transaction pagination (2026-08-03)

- A fresh read-only QBO Bank transactions audit shows 9 account-fetch errors while retaining existing transactions, account cards with Bank and Posted balances, Pending / Posted / Excluded queues, All dates, `1-50 of 401`, page `1 of 9`, and table columns Date, Bank Description, Spent, Received, From/To, Match/Categorize, and Action. Visible Pending rows expose Match, Categorize, and Post. No account repair, link, row action, filter, pagination, print, export, or post action was invoked.
- REFS Bank Transactions now pages its local filtered queue at 50 records, displays the local result range/count, and provides Previous/Next only when local evidence spans multiple pages. This is presentation-only: it does not change matching, categorization, exclusions, queue state, or ledger/posting behavior.
- `node verify-bank-transaction-pagination.mjs`, `node verify-bank-matching.mjs`, `node verify-bank-reconciliation.mjs`, and `node build.mjs` all exit 0 (bundle 511.5kb). QBO pagination behavior, exact row count, account errors/repair, Post semantics, filters, permissions, audit, attachment column, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Receipts view state (2026-08-03)

- A fresh read-only QBO Receipts audit confirms For review and Reviewed views, Filter and Customize, the RECEIPT / CREATED BY / DATE / VENDOR / PAYMENT ACCOUNT / AMOUNT / TAX / CATEGORY / ACTION columns, and the empty pagination state `0 - 0 of 0 items`, `Page of 1`. No filter, customization, upload, forwarding, review, export, or row action was invoked.
- REFS Receipts now allows switching the two locally empty list views and announces the selected local view and its distinct empty condition. This selector cannot upload, review, create a bill/expense, or write receipt state.
- `node verify-receipt-view-state.mjs`, `node verify-bank-transaction-pagination.mjs`, `node verify-bank-matching.mjs`, `node verify-bank-reconciliation.mjs`, and `node build.mjs` all exit 0 (bundle 511.9kb). QBO filter/customization behavior, receipt data, uploader, forwarding, autofill, review creation, conversion, permissions, audit, responsive behavior, and equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Bill payments date history (2026-08-03)

- A read-only visit to the current QBO Bill Pay route exposed an error notice, `We can’t schedule the bills you selected`, without any user selection or payment action. This is recorded as transient page state only; it does not establish scheduling, validation, status, or recovery semantics.
- REFS payment history now uses a separate local-only date filter contract: All dates returns paid local bill evidence; This month matches the recorded payment date against the explicit local reference month. It cannot invoke QBO Bill Pay or schedule a payment.
- `node verify-payment-history-listing.mjs`, `node verify-receipt-view-state.mjs`, `node verify-bank-matching.mjs`, `node verify-bank-reconciliation.mjs`, and `node build.mjs` all exit 0 (bundle 512.1kb). QBO Bill Pay error cause, scheduling, eligibility, filter options, payment status, settlement, cancellation, audit, permissions, responsive behavior, and equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Expenses empty state and local AP drill contract (2026-08-03)

- A fresh read-only QBO Expenses audit shows the Expenses title, Create and all-app navigation, the Expenses & Bills links (Expense transactions, Vendors, Bills, Bill payments, Contractors, and 1099s), New transaction, the Intuit Expert Assisted offer, Filter, Dates set to Last 12 months, and the empty state `No expenses found` / `Try to change some filters to see more results.` No navigation, filter, transaction, offer, feedback, print, or export action was invoked.
- REFS now uses one local AP drill resolver for Bills context: a local bill id, bill number, AP JE, or payment JE can resolve an existing local bill detail; unknown context resolves nothing. This supports existing Bill, Payment-history, and Aging drill affordances without changing the accounting/posting kernel or invoking QBO.
- `node verify-ap-drill.mjs`, `node verify-payment-history-listing.mjs`, `node verify-receipt-view-state.mjs`, `node verify-bank-matching.mjs`, `node verify-bank-reconciliation.mjs`, and `node build.mjs` are the required local regression gates. QBO navigation destinations, empty-state transitions, bill detail fields, JE drill behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Bills queue tabs (2026-08-03)

- A fresh read-only QBO Bills audit shows the Bills title; Pay bills and Add bill controls; How to manage bills; the queue tabs For review, Unpaid, Paid, and Recurring (marked NEW); a Bill Date control showing `01/01/2026–12/31/2026`; Customize; and the empty pagination state `0 - 0 of 0 items`, `Page of 1`. No bill creation, payment, date change, customization, tab change, or help action was invoked.
- REFS Bills now presents the observed queue labels and makes only locally supportable queues interactive. Its explicitly documented local mapping is For review = `PENDING_APPROVAL`, Unpaid = `DRAFT` or `APPROVED`, and Paid = `PAID`; Recurring remains disabled because no local recurring-bill evidence exists. Changing a local queue clears only the separate local status filter and does not create, approve, pay, change, or post any bill.
- `node verify-bill-queue-view.mjs` and `node build.mjs` verify the local mapping/build. QBO tab membership, date/customize control semantics, table columns, pagination, recurring behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Bill payments empty state (2026-08-03)

- The direct `/app/billpay` route showed `We can’t schedule the bills you selected`; a non-mutating inspection of the Bills navigation established the actual Bill payments link as `/app/bill-payments?jobId=expenses`. After the page settled, the read-only audit showed Bill payments, Pending approval (NEW), Payments, Filters, Payment date set to All dates, and `Make payments easy with QuickBooks Bill Pay` / `When you use QuickBooks Bill Pay, you’ll find all your payment details here.` No payment, filter, tab, or other data action was invoked.
- REFS Payments now renders that observed empty-state copy only when its existing local paid-evidence filter has no result. It explicitly labels the local payment run as separate and does not schedule or invoke QuickBooks Bill Pay.
- `node verify-payment-history-listing.mjs` and `node build.mjs` are required local gates. The direct route error cause, QBO queue membership, Filter/Payment-date semantics, QBO Bill Pay enrollment, scheduling, network settlement, cancellation, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Vendors list and create-bill entry (2026-08-03)

- A fresh read-only QBO Vendors audit shows Pay vendors, New vendor, Unpaid Last 365 Days ($0.00 / 0 overdue / $0.00 / 0 open bills), Paid ($0.00 / 0 paid last 30 days), the Intuit Expert Assisted offer, one connection-request notice, and a paginated vendor list (`1-50 of 947`). Observed columns are Vendor, Company Name, Phone, Email, 1099 Tracking, Open Balance, and Action; visible rows expose Create bill. No vendor, payment, request, promotion, row, or pagination action was invoked.
- REFS Vendors now has local unpaid/paid summary cards, name/code search, the observed column shell, and an Action that opens the existing local Bill form with the selected local vendor prefilled. Phone/email stay visibly unavailable because the local vendor evidence does not contain them; Pay vendors and New vendor stay disabled. This only changes REFS UI state and can create a local bill through the existing guarded workflow, never a QBO bill or payment.
- `node verify-vendor-listing.mjs` and `node build.mjs` are required local gates. QBO vendor data, list cardinality/pagination, summary-period semantics, connection requests, promotion enrollment, New vendor, Pay vendors, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Receipts filter and view-empty states (2026-08-03)

- A fresh read-only QBO Receipts audit confirms Upload receipts, For review, Reviewed, Filter, Customize, the RECEIPT / CREATED BY / DATE / VENDOR / PAYMENT ACCOUNT / AMOUNT / TAX / CATEGORY / ACTION columns, and `Add new receipts to get started` with `0 - 0 of 0 items`, `Page of 1`. Opening Filter without changing values shows Dates (From/To, current date), Account/Category, Amount (Minimum/Maximum), Reset, and Apply. It also reveals the upload instruction, company forwarding address, drag/drop affordance, Upload from this device, and PDF/PNG/JPEG/HEIC format list. No upload, forwarding, field edit, Reset, Apply, customization, view change, or row action was invoked.
- REFS Receipts now switches its primary empty-state heading and description with the existing local For review / Reviewed selection: the observed For review copy remains intact, while Reviewed explicitly states that no local receipt evidence has been marked reviewed. The selection cannot upload, filter, review, or modify receipt state.
- `node verify-receipt-view-state.mjs` and `node build.mjs` are required local gates. QBO Filter date/category/amount matching, Reset/Apply semantics, uploader/forwarding/autofill, customization, review conversion, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Bank transactions pagination state (2026-08-03)

- A fresh read-only QBO Bank transactions audit on the actual `/app/banking?jobId=accounting` route shows Update, Link account, multiple account cards with Bank/Posted balances and dates, Go to bank register, Pending (1,402) / Posted / Excluded, All dates, `1-50 of 401`, `Page of 9`, columns Date / Bank Description / Spent / Received / From/To / Match/Categorize / Action, and visible Pending actions Match, Categorize, and Post. No account, tab, filter, row action, pagination, update, or link action was invoked.
- REFS now always renders its local current-page state with Previous/Next bounds, including a one-page empty/filter result. It retains its existing local Match/Categorize behavior; the observed Post control is visibly present but disabled, because QBO Post semantics were not exercised and must not be inferred.
- `node verify-bank-transaction-pagination.mjs`, `node verify-bank-matching.mjs`, and `node build.mjs` are required local gates. QBO account-card selection, balances, filters, Match/Categorize/Post semantics, exclusions, pagination count, update/link behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Reconcile onboarding shell (2026-08-03)

- A fresh read-only QBO Reconcile audit remains on its onboarding state: `Match the books to the bank records`, `Connected accounts are easier to reconcile. Connect now`, `Video tutorials` with `(7:48)`, the benefit labels Keep yourself on track / Find holes in your accounting / Get things tidy for tax time, and Get started. No account connection, tutorial, setup, account selection, statement entry, reconciliation, or sign-off action was invoked.
- REFS now includes the observed 7:48 tutorial duration in its existing disabled onboarding control. Its separately implemented local reconciliation worksheet and sign-off guard remain local functionality; Connect now, tutorials, and Get started do not invoke QBO or mutate an account connection.
- `node verify-bank-reconciliation.mjs` and `node build.mjs` are required local gates. QBO onboarding destinations, account eligibility, setup, reconciliation workflow, completion report, undo, permissions, audit, empty states, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Rules list columns (2026-08-03)

- A fresh read-only QBO Rules audit on `/app/olbrules?jobId=accounting` shows Learn more, New rule, Bank rules, Integration rules, `1-15 of 15 items`, and columns Priority / Rule Name / Applied To / Conditions / Settings / Auto-Post / Status / Actions. Visible records have Active status and Edit actions; no rule, tab, edit, new-rule, setting, auto-post, or pagination action was invoked.
- REFS Rule Center now renders these observed list columns for its three explicitly local controlled records. Its local search also covers Priority, Applied to, Conditions, Settings, Auto-post, and Status; priority is display-only and Edit/auto-post remain disabled. It neither reads, copies, creates, edits, reorders, applies, nor posts a QBO rule.
- `node verify-accounting-rule-listing.mjs` and `node build.mjs` are required local gates. QBO search/control behavior, Integration rules, priority ordering, per-account application, condition/settings semantics, auto-post, Active/Edit behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Chart of accounts drill split correction (2026-08-03)

- A fresh read-only QBO Chart of accounts audit shows All lists, Run report, New account, Batch actions, Batch edit, Previous/Next, loading state, the Name / Account Type / QuickBooks Balance / Bank Balance / Action columns, and after load `1 - 200` / `Showing accounts 1 to 200`. Visible Other Current Liabilities and Equity rows expose View register; visible Income, Cost of Goods Sold, and Expenses rows expose Run report. No account, filter, batch action, report, register, create, print/export, settings, or pagination action was invoked.
- REFS corrects its existing local account drill split: ASSET, LIABILITY, and EQUITY records open the local Account Register, while REVENUE and EXPENSE records open local GL Detail. This changes navigation only; it does not edit an account, create a report, or retrieve QBO data.
- `node verify-chart-account-actions.mjs` and `node build.mjs` are required local gates. QBO account-type coverage, balances, All lists/filter behavior, actual report/register destination semantics, batch actions, creation, pagination, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update — Reports financial-summary labels (2026-08-03)

- A fresh read-only QBO Reports audit shows the Reports & Analytics navigation, Create new report, Smart reporting tip, `I generated a financial summary for June`, Review Summary, Shortcuts / Performance center / View dashboard, Favorites, and the favorite report names Accounts receivable aging summary, Balance Sheet, and Profit and Loss. No search, report creation, favorite change, report opening, dashboard opening, or summary action was invoked.
- REFS now labels its local summary as Financial summary for June and adds the observed Profit and Loss report name as a local alias for the existing Income Statement drill. The alias opens only local GL Income Statement context; it does not fetch, create, favorite, or modify a QBO report, and it does not add Sales/AR functionality.
- `node verify-report-favorites.mjs` and `node build.mjs` are required local gates. QBO financial-summary content/date, Review Summary destination, favorites/persistence/menu behavior, search, report creation, dashboard navigation, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.
## QuickBooks read-only evidence & REFS update — business-fit Reports scope (2026-08-03)

- Read-only QBO Standard reports evidence confirms the Reports & Analytics navigation and favorites for Accounts receivable aging summary, Balance Sheet, and Profit and Loss. It also visibly lists Spreadsheet sync, KPIs, Dashboards, Performance center, and Financial planning. No QBO report, favorite, search, dashboard, connection, or data action was invoked.
- REFS now makes a deliberate business-fit boundary visible in Reports: financial statements, GL/TB drills, expense/AP/AR/bank/reconciliation controls, and property/project cost reporting are retained; Amazon/marketplace channels, external apps/data-source connections, Spreadsheet Sync, Excel/Google Sheets two-way/bulk sync, multi-company spreadsheet reports, Sales Growth KPIs, and Sales-performance dashboards are reference-only/excluded. This is a local product-scope decision, not a claim that QBO destinations are equivalent.
- `node verify-report-business-scope.mjs` and `node build.mjs` are required local gates. QBO navigation eligibility, KPI/dashboard contents, spreadsheet connection, sales and external integrations, permissions, audit, responsive behavior, and all excluded capabilities remain unverified and are not claimed.
## QuickBooks read-only evidence & REFS update — Invoices business-fit boundary (2026-08-03)

- A read-only QBO Invoices visit shows Sales & Get Paid navigation (Overview, Sales transactions, Invoices, Payment links, Recurring payments, Sales orders, Sales channels, QuickBooks payouts, Products & services, Customer Hub), a `Create invoice` action, a `Record a customer payment` resource, and online-payment promotion for cards, ACH, Apple Pay, PayPal, and Venmo. No invoice, payment, link, enrollment, comparison, channel, or record action was invoked.
- REFS relabels this existing local area as `Receivables · local close` and adds an explicit business-fit boundary: tenant, owner, and related-party invoice → local receipt → AR aging stays in scope; online payment processing, payment links, recurring payments, sales orders/channels, marketplaces, and external payouts are excluded. Existing JE posting is unchanged.
- `node verify-receivables-business-scope.mjs` and `node build.mjs` are required local gates. QBO invoice list/detail, create/send/record-payment semantics, payment-method enrollment and settlement, links, recurring/sales-order/channel/payout operations, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.
## QuickBooks read-only evidence & REFS update — Receipts close boundary (2026-08-03)

- A fresh read-only QBO Receipts audit shows Loading, Upload receipts, drag/drop and device-upload affordances, PDF/PNG/JPEG/HEIC formats, For review / Reviewed, Filter, Customize, columns RECEIPT / CREATED BY / DATE / VENDOR / PAYMENT ACCOUNT / AMOUNT / TAX / CATEGORY / ACTION, and `Add new receipts to get started` with `0 - 0 of 0 items`, `Page of 1`. No upload, file selection, forwarding, filter, customization, view switch, review, export, or row action was invoked.
- REFS now keeps the observed queue and columns but makes the business boundary explicit: a local receipt is only a review-state hint for existing bank-match work; it cannot imply a bank link when no retained local receipt/source record exists. Upload, email forwarding, autofill, bill/expense conversion, external storage, and OCR integrations are excluded. Rent-like bank candidates are labeled tenant/owner rather than a generic sales customer.
- `node verify-receipt-view-state.mjs`, `node verify-bank-matching.mjs`, `node verify-bank-transaction-pagination.mjs`, and `node build.mjs` are required local gates. QBO uploader, extraction, receipt review/conversion, filters, customization, bank-linking, connection, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.
## QuickBooks read-only evidence & REFS update — Bank Pending posting trace (2026-08-03)

- A fresh read-only QBO Bank transactions audit shows account cards with bank/posted balances and dates, Update, Link account, Go to bank register, Pending / Posted / Excluded, All dates, `1-50 of 401`, `Page of 9`, and Date / Bank Description / Spent / Received / From/To / Match/Categorize / Action columns. Visible Pending rows show Match, Categorize, and Post, including counterparty/category selections such as a related party, services, or Select customer. No account, filter, row, match, categorize, post, link, update, register, pagination, or export action was invoked.
- REFS now exposes a local trace only after one locally Posted bank item is selected: retained posted evidence can open its local Journal Entry, GL Detail, or Trial Balance context; missing evidence keeps every drill unavailable. This is navigation over existing local evidence, not a posting/matching action. The QBO-like Post control remains visible and disabled because its meaning was not exercised. Local labels distinguish tenant/owner receipt candidates and local category suggestions from external sales/AutoRec workflows.
- `node verify-bank-matching.mjs`, `node verify-bank-transaction-pagination.mjs`, and `node build.mjs` are required local gates. QBO account-card selection, balances, From/To/counterparty editing, match/categorize/post behavior, status transitions, link/update/register, filters, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.
## QuickBooks read-only evidence & REFS update — Reconcile onboarding/history boundary (2026-08-03)

- A fresh read-only QBO Reconcile audit remains on the onboarding screen: `Match the books to the bank records`, `Connected accounts are easier to reconcile. Connect now`, Video tutorials `(7:48)`, Keep yourself on track, Find holes in your accounting, Get things tidy for tax time, and Get started. No connection, account selection, statement entry, reconciliation, completion, history, undo, or report action was invoked; none is inferred.
- REFS retains these observed controls as disabled evidence only. Its existing local reconciliation worksheet now makes a selected-account local sign-off history empty state explicit; history is scoped to local account evidence and its existing Bank/GL drills are not a claim of QBO reconciliation-history behavior. Reconciliation calculations, sign-off decision, and ledger state are unchanged.
- `node verify-bank-reconciliation.mjs` and `node build.mjs` are required local gates. QBO connection/setup, account/statement selection, completion/history/undo/report behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.
## QuickBooks read-only evidence & REFS update — Bills queues and AP Aging report date (2026-08-03)

- A fresh read-only QBO Bills audit shows Expenses & Bills navigation (Expense transactions, Vendors, Bills, Bill payments, Contractors, 1099s), Pay bills, Add bill, How to manage bills, For review / Unpaid / Paid / Recurring (NEW), Vendor, Bill Date, Customize, `Bill Date: 01/01/2026–12/31/2026`, and `0 - 0 of 0 items`, `Page of 1`. No bill, payment, vendor, date, queue, customize, print/export, or pagination action was invoked.
- REFS AP Aging now takes an explicit local report date and derives Current / 1-30 / 31-60 / 60+ from the selected date; only unpaid/non-void retained local bill evidence remains. Row drill continues to local Bill detail. Existing local queue mapping retains For review/Unpaid/Paid and leaves Recurring unavailable; no QBO Bill Pay or recurring-bill behavior is implied.
- `node verify-ap-aging.mjs`, `node verify-bill-queue-view.mjs`, and `node build.mjs` are required local gates. QBO queue membership, report/filter/customize semantics, Bill Date range application, add/pay/recurring behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Reports aging workflow targets (2026-08-03)

- A fresh read-only QBO Standard reports audit shows Reports & Analytics navigation, Standard reports / Custom reports / Management reports, Create new report, a June financial-summary prompt, Favorites for Accounts receivable aging summary, Balance Sheet, and Profit and Loss, plus visible Spreadsheet sync / Performance center / planning navigation. No report, favorite, summary, dashboard, connection, export, or creation action was invoked.
- REFS now routes AP Aging to the local AP Aging tab, Accounts receivable aging summary to the local AR Aging tab, and Reconciliation History to the local reconcile workspace. The AR workspace now accepts the local aging tab context. These are local close-navigation contracts over retained evidence only; external syncing, sales, and QBO report behavior are not implemented.
- `node verify-report-workflow-targets.mjs`, `node verify-report-favorites.mjs`, `node verify-ap-aging.mjs`, and `node build.mjs` are required local gates. QBO favorite persistence, report contents/filters/customization, aging calculation, drill behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Income overview business-fit boundary and AR Aging (2026-08-03)

- A fresh read-only QBO Sales & Get Paid overview audit shows its Overview / Sales transactions / Invoices / Payment links / Recurring payments / Sales orders / Sales channels / QuickBooks payouts / Products & services / Customer Hub navigation. Its current content promotes Payments, Affirm, estimates, proposals, e-signatures, progressive invoices, and payment activation. No payment enrollment, proposal, estimate, invoice, sales action, connection, or export was invoked.
- REFS retains this only as a boundary reference. Local AR Aging now has an explicit report date, Current / 1-30 / 31-60 / 60+ rows derived solely from retained OPEN invoices, and a row return to selected local invoice evidence with source JE. It does not add quotes, recurring invoices, payment processors, sales channels, marketplace payouts, or any QBO synchronization.
- `node verify-ar-aging.mjs`, `node verify-receivables-business-scope.mjs`, and `node build.mjs` are required local gates. QBO aging, invoice/payment lifecycle, sales-activation, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Receipts retained-evidence bank bridge (2026-08-03)

- A fresh read-only QBO Receipts audit shows the Accounting navigation, Upload receipts, For review / Reviewed, Filter, Customize, columns RECEIPT / CREATED BY / DATE / VENDOR / PAYMENT ACCOUNT / AMOUNT / TAX / CATEGORY / ACTION, and the empty state `Add new receipts to get started`, `0 - 0 of 0 items`, `Page of 1`. No upload, review, filter, customize, row action, export, or receipt edit was invoked.
- REFS now derives a local Receipt record only from an already POSTED local cash-receipt JE and exposes a bank drill only where that same local JE is already matched to a retained CREDIT bank transaction. The existing seed rent receipt therefore appears only in local Reviewed evidence and can open its existing local source JE or matched bank record. It does not create a receipt, match a bank item, alter a review state, upload a document, or call QBO.
- `node verify-receipt-bank-evidence.mjs`, `node verify-receipt-view-state.mjs`, `node verify-bank-matching.mjs`, and `node build.mjs` are required local gates. QBO extraction/review/conversion, filters/customize, matching behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Reconcile source-context boundary (2026-08-03)

- A fresh read-only QBO Reconcile audit shows the accounting navigation and its onboarding shell: `Match the books to the bank records`, `Connected accounts are easier to reconcile`, Connect now, `(7:48)`, Keep yourself on track, Find holes in your accounting, Get things tidy for tax time, and Get started. No connection, account selection, statement entry, matching, reconciliation, sign-off, history, undo, or report action was invoked.
- REFS now lets one locally Posted bank item open the existing local reconcile workspace with that account and transaction context. The context is eligible only when the retained bank transaction is MATCHED; unmatched or missing evidence shows an explicit unavailable state. This is navigation only: balances, worksheet handling, history, sign-off guards, and ledger state are unchanged.
- `node verify-bank-reconciliation.mjs`, `node verify-bank-matching.mjs`, and `node build.mjs` are required local gates. QBO account eligibility, onboarding, statement/reconcile workflow, history/undo/report behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Bill payments posted-evidence drill (2026-08-03)

- A fresh read-only QBO Bill payments audit shows Expenses & Bills navigation, Bill payments, Pending approval (NEW), Payments, Filters, Payment date / All dates, and the Bill Pay empty copy `Make payments easy with QuickBooks Bill Pay` / `When you use QuickBooks Bill Pay, you'll find all your payment details here.` No payment, filter, tab change, enrollment, settlement, export, or row action was invoked.
- REFS payment history now exposes GL and TB navigation only if the paid local bill has a retained POSTED payment JE. The existing payment-JE drill stays available; absent, non-paid, or non-posted evidence shows an unavailable state. This makes no network payment and does not change AP, cash, audit, journal, or report state.
- `node verify-payment-evidence-drill.mjs`, `node verify-payment-history-listing.mjs`, and `node build.mjs` are required local gates. QBO Bill Pay filters, eligibility, network settlement, payment detail/drill semantics, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Bills evidence and approval trace boundary (2026-08-03)

- A fresh read-only QBO Bills audit shows Pay bills, Add bill, file-forwarding/autofill promotion, How to manage bills, For review / Unpaid / Paid / Recurring (NEW), Vendor, Bill Date, Customize, columns VENDOR / DUE DATE / BILL AMOUNT / OPEN BALANCE / STATUS / ACTION, the `No bills found` state, Upload files, totals, and `0 - 0 of 0 items`, `Page of 1`. No bill, upload, forwarding, filter, queue, customize, payment, export, or row action was invoked.
- REFS Bill detail now presents a local evidence trace for the retained AP JE, payment JE, and source-document id. A source-document action appears only when the exact local AP JE already carries one; missing evidence is explicit. The existing maker/approver/post/payment timeline remains unchanged, and this trace cannot create, upload, autofill, approve, edit, or pay a bill.
- `node verify-bill-evidence-trace.mjs`, `node verify-ap-drill.mjs`, and `node build.mjs` are required local gates. QBO bill detail, file processing, queue/column behavior, actions, approval/audit semantics, permissions, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - GL source-workspace routing (2026-08-03)

- A fresh read-only QBO Standard reports audit shows Reports & Analytics navigation, Standard / Custom / Management reports, Create new report, Performance center, Favorites for Accounts receivable aging summary, Balance Sheet, and Profit and Loss, and visible Spreadsheet sync / planning surfaces. No report, favorite, customization, creation, dashboard, connection, or export action was invoked.
- REFS GL Detail now resolves an existing local source JE to AP Bill, AR Invoice (including receipt JE), matched Bank transaction, or retained source document context. The AR workspace receives invoice id / JE context and selects its existing local evidence. Unknown manual evidence has no destination. This is navigation over retained local objects only; it does not introduce QBO Sales, spreadsheet sync, or external data surfaces.
- `node verify-gl-source-target.mjs`, `node verify-ar-aging.mjs`, and `node build.mjs` are required local gates. QBO report drill/favorites/customization, source semantics, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - GL source-document empty-route guard (2026-08-03)

- A fresh read-only QBO Standard reports visit shows Reports & Analytics navigation, Standard / Custom / Management reports, KPI/dashboard and Spreadsheet sync navigation, Create new report, and the Performance center shortcut. No report creation, customization, dashboard, connection, favorite, filter, export, or report opening was invoked.
- REFS GL source routing now opens a local Source Documents workspace only when the JE's source-document id exists in the retained local register. A missing id falls through to another retained AP/AR/Bank source where available, otherwise exposes no source control. This prevents a local report user from reaching a known-empty source-document shell and changes no journal, report values, or audit state.
- `node verify-gl-source-target.mjs` and `node build.mjs` are required local gates. QBO report/source validation, drill, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Bank drill focus and pagination consistency (2026-08-03)

- A fresh read-only QBO Bank transactions audit shows account cards with Bank and Posted balances/dates, Update, Link account, Go to bank register, Pending (1,402) / Posted / Excluded, All dates, `1-50 of 401`, `Page of 9`, and Date / Bank Description / Spent / Received / From/To / Match/Categorize / Action columns. Visible Pending rows expose Match, Categorize, and Post. No account, filter, page, match, categorize, post, update, link, register, or export action was invoked.
- REFS now resolves a Bank drill to the exact local queue page that contains the requested retained transaction, clears stale local query/date/type filters that could hide it, and explicitly reports a missing local transaction instead of claiming focus. This is display/navigation only; it does not match, categorize, post, exclude, restore, or modify reconciliation state.
- `node verify-bank-transaction-pagination.mjs`, `node verify-bank-reconciliation.mjs`, and `node build.mjs` are required local gates. QBO account selection, filter/page semantics, actions, balances, reconcile linkage, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Vendors balance-to-AP workflow (2026-08-03)

- A fresh read-only QBO Vendors audit shows Pay vendors, New vendor, Unpaid Last 365 Days / Overdue / Open Bills / Paid Last 30 Days summary cards, Expert Assisted promotion, VENDOR / COMPANY NAME / PHONE / EMAIL / 1099 TRACKING / OPEN BALANCE / ACTION columns, Create bill actions, and `1-50 of 947`, page navigation through 19 pages. No vendor, bill, payment, page, export, filter, or profile action was invoked.
- REFS Vendor rows now open the selected local vendor's Bills or, only when its retained local balance is non-zero, its AP Aging view. The handoff clears unrelated local filters and preserves only the vendor constraint; zero balance disables Aging. Create local bill remains the existing local workflow. No vendor creation, QBO pay-vendor action, or balance mutation occurs.
- `node verify-vendor-listing.mjs`, `node verify-ap-aging.mjs`, and `node build.mjs` are required local gates. QBO vendor fields/search/paging, balance calculation, Create bill/Pay vendors behavior, 1099 tracking, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Chart account scoped GL empty state (2026-08-03)

- A fresh read-only QBO Chart of accounts audit shows All lists, Run report, New account, Batch actions, Batch edit, Previous / Next, `1 - 200`, account name/type, QuickBooks Balance / Bank Balance, View register actions, and visible bank and other-current-asset rows. No account, batch edit, report, register, settings, pagination, print, export, or creation action was invoked.
- REFS retains its account-type split (balance-sheet accounts to local register; revenue/expense accounts to scoped GL Detail) and now makes a scoped `No posted local activity` state explicit for a selected account/date period. It prevents an empty local drill from looking like a loaded report and does not edit account status, chart records, or accounting data.
- `node verify-chart-account-actions.mjs`, `node verify-gl-drill-state.mjs`, and `node build.mjs` are required local gates. QBO balances, actions, batch behavior, report/register contents, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Sales overview business-fit boundary (2026-08-03)

- A fresh read-only QBO Sales & Get Paid overview audit exposes Overview, Sales transactions, Invoices, Payment links, Recurring payments, Sales orders, Sales channels, QuickBooks payouts, Products & services, and Customer Hub in the application navigation. No QBO action, enrollment, connection, payment, invoice, export, or data change was invoked.
- REFS uses that surface solely as information-architecture reference. The product scope is now explicit: local bills/expenses, tenant-owner-related-party receivables, receipts, bank/reconcile, GL/TB/aging, and property/project close controls remain; marketplace/ecommerce channels, payment processors/links/payouts, external app connections, spreadsheet sync, external storage, and bulk sync are excluded.
- The legacy Integration Hub is no longer exposed in REFS navigation or route mapping. Existing local source-document/staging controls remain, and no external connector has been added.
- `node verify-business-scope.mjs` and `node build.mjs` are required local gates. QBO sales workflows, payment enrollment/settlement, channel/payout behavior, permissions, audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - GL/TB local property-project-loan scope (2026-08-03)

- A fresh read-only QBO Standard reports audit shows Reports & Analytics navigation with Standard reports, Custom reports, Management reports, KPIs, Dashboards, Spreadsheet sync, Performance center, Financial planning, Cash flow planner, Budgets, and Forecasts. No report, search, customization, creation, export, sync, KPI, dashboard, or data action was invoked.
- Following the business-fit review, REFS retains only local accounting dimensions: Property, Project, and Loan selections now scope posted journal **lines** in GL/TB, statement drill-down, and transaction detail. GL Detail displays the retained Property / Project / Loan code(s); the selected scope is visible in the report and drill summaries. Project selection includes lines tagged directly to its project and property-tagged lines belonging to that project.
- A dimension-filtered result is explicitly a local tagged-line view. Untagged balancing counterpart lines are not inferred, created, or mutated; report balance, QBO customization, KPIs/dashboards, custom/management reports, spreadsheet/data connections, and all external or sales capabilities remain unverified and are not claimed.
- `node verify-gl-dimension-scope.mjs`, `node verify-gl-drill-state.mjs`, and `node build.mjs` are required local gates.

## QuickBooks read-only evidence & REFS update - Balance Sheet local as-of evidence (2026-08-03)

- QBO Reports remained read-only on the Standard reports information architecture: Standard / Custom / Management reports, KPIs, Dashboards, Spreadsheet sync, Performance center, Financial planning, Cash flow planner, Budgets, and Forecasts were visible. No report was opened, customized, created, printed, exported, synced, or changed.
- Based on the business-fit review, REFS Balance Sheet now uses only the selected entity, cutoff period, retained local dimension scope, and all locally POSTED journal evidence through that cutoff. Changing the display From period does not define the Balance Sheet result. Its account/total drills retain the same Opening-through-cutoff evidence set, and no-result scope is explicit.
- Opening-balance migration date, retained-earnings rollover, and intercompany elimination rules are not present in this local data set. Accordingly this is a cumulative-local-evidence Balance Sheet, not a claimed formal statutory/QBO balance sheet; external imports, multi-company packaging, print/email/export workflows, sales measures, and KPI/budget surfaces remain excluded or unverified.
- `node verify-balance-sheet-asof.mjs`, `node verify-gl-dimension-scope.mjs`, and `node build.mjs` are required local gates.

## QuickBooks read-only evidence & REFS update - Cash Flow local evidence classification (2026-08-03)

- A QBO Reports navigation revisit was read-only; the report page did not return stable report-body controls before the inspection window ended, so no new QBO Cash Flow report interaction or semantics are claimed. Earlier observed report-navigation items remain reference-only.
- Following the business-fit review, REFS Cash Flow now takes only retained POSTED cash/bank lines in the selected entity, period, and local Property/Project/Loan scope. A cash JE is classified once as Operating, Investing, or Financing; each category drills into the same retained local GL/JEs and their source workflows. The view displays opening cash, closing cash, and a same-scope Balance Sheet cash cross-check.
- Intercompany cash and any unsupported cash counterpart are no longer silently treated as Operating: they surface as explicit review-required evidence and prevent the report from being Ready. Restricted/escrow cash, deposits, capitalized-interest policy, loan-use allocation, opening migration, and eliminations remain unverified business policies; external connections, forecasts, scenarios, sales cash flow, AI classification, spreadsheet sync, and QBO sharing/export workflows are excluded.
- `node verify-cash-flow-evidence.mjs`, `node verify-balance-sheet-asof.mjs`, and `node build.mjs` are required local gates.

## QuickBooks read-only evidence & REFS update - Local cash account scope (2026-08-03)

- A fresh read-only QBO Chart of accounts visit shows the Accounting title plus All lists, Run report, New account, Batch actions, and Batch edit. No account, batch, report, register, setting, or balance action was invoked.
- Following the business-fit review, REFS now separates local posted cash-ledger evidence into Operating, Escrow, Restricted, Security deposit, and Payroll-restricted groups. Cash Management displays the account code, local posted balance, retained JE count, and only local bank-master evidence; it never represents a bank feed, balance pull, connection, or gateway.
- Cash Flow and its Balance Sheet cross-check now default to Operating cash only. Escrow/restricted/deposit/payroll balances remain visibly separate and are excluded from available-operating-cash conclusions until legal/business availability and reconciliation policy is supplied. Missing bank-master evidence is explicit, not inferred.
- `node verify-cash-account-scope.mjs`, `node verify-cash-flow-evidence.mjs`, and `node build.mjs` are required local gates. QBO account behavior/balances, bank feeds, register/reconcile outcomes, permissions, audit, responsive behavior, and equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Account Register local evidence boundary (2026-08-03)

- A fresh read-only QBO Chart of accounts audit shows the Accounting navigation, Chart of accounts, All lists, Run report, New account, Batch actions / Batch edit, 1 - 200 pagination, and the Name / Account type / QuickBooks balance / Bank balance / Action columns. Visible Bank and A/R rows expose `View register`. No account, register, report, pagination, balance, creation, batch edit, export, or transaction action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS Account Register now limits its rows and running balance to the selected entity, account, through-period, and retained POSTED local JEs, ordered by date/reference/line. It displays local source, counterparty/memo, Property/Project/Loan tags, debit, credit, running balance, and explicit local bank-match evidence. Operating, Escrow, Restricted, Security deposit, and Payroll-restricted cash scopes remain separate; bank match is explicitly not reconciliation sign-off. Row drill goes to the retained JE, and source drill is available only for retained local AP/AR/bank/PM evidence (not WBS or external workspaces).
- This is a cumulative retained-local-evidence register, not a QBO/connected-bank register. Opening migration, formal bank-account-to-GL mapping, statement imports, outstanding-item policy, deposit/trust legal ownership, loan restrictions, register edit/void/payment behavior, permissions, audit, responsive behavior, and QBO functional equivalence remain unverified and are not claimed. External bank feeds/downloads/sync, wallets/channels, cross-entity aggregation, bulk export, and QBO register mutation are excluded.
- `node verify-account-register-evidence.mjs`, `node verify-cash-account-scope.mjs`, `node verify-gl-source-target.mjs`, and `node build.mjs` are required local gates.

## QuickBooks read-only evidence & REFS update - Reconcile local proof gate (2026-08-03)

- A fresh read-only QBO Reconcile visit opened the current onboarding shell: `Match the books to the bank records`, `Connected accounts are easier to reconcile. Connect now`, Video tutorials `(7:48)`, Keep yourself on track, Find holes in your accounting, Get things tidy for tax time, and Get started. No connection, account setup, statement entry, match, reconciliation, completion, history, undo, report, export, or data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS Reconciliation now resolves each retained account to explicit master scope (entity, Operating/Escrow scope, and mapped local cash GL), computes the local posted cash balance through the statement cutoff, and compares it with the retained worksheet balance. Every locally MATCHED bank item must have a same-entity, through-cutoff, local POSTED matched JE with the mapped cash amount equal to its signed bank amount. Missing/unposted JEs, cash amount mismatch, missing mapping, non-operating scope, ledger mismatch, open unmatched activity, and duplicate sign-off all block the existing guarded sign-off. Bank matching is explicitly not inferred from POSTED status.
- The view adds an explicit `IN_REVIEW` / `BALANCED` / `SIGNED_OFF` local phase, local ledger-proof and matched-item-proof tables, local empty states, and account-scoped history. It does not connect or refresh a bank, upload/parse a statement, automate matching, create a payment, synchronize a wallet/channel, or change the accounting kernel. Escrow, trust, security-deposit, payroll-restricted, and loan-draw funds are not allowed into Operating-cash sign-off; legal ownership, opening outstanding items, and loan-use policy remain unverified.
- `node verify-reconciliation-local-evidence.mjs`, `node verify-bank-reconciliation.mjs`, `node verify-cash-account-scope.mjs`, and `node build.mjs` are required local gates. QBO onboarding/setup, statement/reconcile flow, permissions, audit, history/undo/report, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Invoice and Receipt local-close proof (2026-08-03)

- A fresh read-only QBO Invoices visit showed Sales & Get Paid navigation with Overview, Sales transactions, Invoices, Payment links, Recurring payments, Sales orders, Sales channels, QuickBooks payouts, Products & services, and Customer Hub. The current Invoice body promoted `Create with AI`, `Streamline invoicing with QuickBooks Payments`, `Create invoice`, flexible card/debit/ACH/Apple Pay/PayPal/Venmo options, and `Record a customer payment`. No invoice creation, AI prompt, payment activation, payment recording, rate comparison, send, export, or data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS Invoice rows now resolve their retained AR source JE and receipt JE before enabling the existing local payment action. A valid invoice source must be POSTED and debit local AR for the invoice amount; a valid receipt must be POSTED, in the same entity, debit local cash and credit local AR for the same amount. `BANK_MATCHED` is shown only when a retained MATCHED CREDIT bank item points to that receipt JE with the exact amount. Missing/unposted source, AR amount mismatch, missing receipt, partial/amount mismatch, cross-entity receipt, and non-exact/missing bank evidence remain explicit states; they are never inferred from UI or POSTED labels.
- The local Invoice detail now drills only to retained source/receipt JEs and exact bank evidence, while aging remains report-date based over OPEN local invoices. Receipt evidence now requires an exact locally MATCHED credit rather than merely a linked bank transaction. Deposits/restricted-funds remain a liability/availability review, not inferred rent revenue. Payment links, online card/ACH collection, Sales orders/channels, recurring payments, customer portal, proposals, AI invoice creation, marketplaces, payout workflows, and external sync are excluded.
- `node verify-invoice-receipt-evidence.mjs`, `node verify-receipt-bank-evidence.mjs`, `node verify-ar-aging.mjs`, and `node build.mjs` are required local gates. QBO invoice lifecycle, payments settlement, permissions, audit, empty states, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Bill and Vendor Payment local proof (2026-08-03)

- A fresh read-only QBO Bills audit showed Expenses & Bills navigation (Expense transactions, Vendors, Bills, Bill payments, Contractors, 1099s), Bills, Pay bills, Add bill, How to manage bills, For review / Unpaid / Paid / Recurring (NEW), Bill Date, Customize, `Bill Date: 01/01/2026–12/31/2026`, and the `0 - 0 of 0 items` / `Page of 1` empty state. No bill, payment, filter, date range, customization, recurring configuration, export, or data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS Bills now resolve a retained AP JE and payment JE before a bill is eligible for the existing local payment queue. A valid AP proof is a POSTED JE that debits the bill category and credits local AP for the exact amount; a valid payment proof is a same-entity POSTED JE that debits local AP and credits local cash for that amount. `BANK_MATCHED` is displayed only for an exact retained MATCHED DEBIT bank item pointing at that payment JE. Missing/unposted AP or payment JEs, amount mismatch/partial payment, cross-entity payment, and missing/non-exact bank evidence remain explicit rather than inferred from Approved/Paid labels.
- Bill and payment tables/detail now expose those proof states, and the payment run admits only valid local AP evidence. The existing workflow remains full-payment only: partial payments, allocations, void/reversal accounting, formal source attachments, tax/CWIP/prepaid/escrow allocation policy, and cross-entity allocation are not implemented and are logged as gaps. QBO Bill Pay, online ACH/check/card payments, OCR/vendor portals, bulk payments, payment providers, and external storage/sync are excluded.
- `node verify-bill-payment-evidence.mjs`, `node verify-bill-evidence-trace.mjs`, `node verify-ap-aging.mjs`, and `node build.mjs` are required local gates. QBO bill/payment lifecycle, settlement, filters/customize, permissions, audit, empty states, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Bank Transactions local-match proof boundary (2026-08-03)

- A fresh read-only QBO Bank transactions audit showed account cards with Bank and Posted balances/dates, Update, Link account, Go to bank register, Pending / Posted / Excluded queues, All dates, pagination, and Date / Bank Description / Spent / Received / From/To / Match-Categorize / Action columns. Visible Pending rows exposed Match, Categorize, and Post. No account, filter, page, match, categorize, post, update, link, register, or export action was invoked.
- Following the Refs助手3-WBS business-fit review, REFS now derives a local proof state per bank item. A record reaches Posted and exposes its JE drill only if exactly one retained local JE is POSTED and proves the same bank-account master, entity, mapped cash GL, signed direction, and amount. Date variance is displayed; same-amount candidates are not sufficient. A defective legacy loan-draw link is intentionally kept in Pending review because its referenced JE does not move the mapped cash GL.
- Operating, Escrow, Restricted/Trust, security-deposit, payroll-restricted, and loan-draw cash must not mix. Unmatched, ambiguous, unposted, cross-entity, missing-master, cash-account, and cash-direction/amount failures remain Review; Excluded remains an audit-rationale gap, not a verified accounting result. No feed/refresh, connector, OCR/AI auto-post, online payment, wallet/channel, marketplace, external attachment, or bulk sync is implemented.
- `node verify-bank-transaction-evidence.mjs`, `node verify-bank-matching.mjs`, and `node build.mjs` pass. QBO matching/categorization/post/exclusion/undo behavior, audit rationale, rules, filters, pagination, permissions, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - AR/AP Aging posted-proof boundary (2026-08-03)

- A fresh read-only QBO Reports audit showed Standard / Custom / Management reports, KPIs, Dashboards, Spreadsheet sync, Performance center, Financial planning, Cash flow planner, Budgets, Forecasts, and a Favorites entry for `Accounts receivable aging summary`. Opening that report exposed Back to standard reports, Customize, Save As, Compact / 100%, `A/R Aging Summary Report`, `As of August 3, 2026`, and the observed empty state: `Your selection doesn’t have any info`. No report customization, save, note, print, export, subscription, or data action was invoked.
- Following the Refs助手3-WBS business-fit review, REFS AR/AP Aging now uses report-date buckets Current / 1-30 / 31-60 / 61-90 / 90+ and includes only retained OPEN documents whose single local source is POSTED and exactly proves the AR/AP control amount. Each included row retains its source object/JE evidence; aggregate detail is cross-checked to the same-source AR or AP control line and visibly reports a difference rather than silently balancing.
- Tenant, owner, related-party, vendor, property/project-tagged observations remain local-only. Paid, void, draft, pending, missing-source, and source-amount-mismatch records are excluded from the report proof set. Partial allocations, formal reversal/void chain validation, source-object entity requirements where the retained object has no entity field, deposit-liability separation, trust/escrow availability, and cross-entity consolidation are gaps, not inferred behavior. QBO email/print/save/subscription/custom packs, payment links/collections, sales channels, Spreadsheet Sync/export, and external connections are excluded.
- `node verify-aging-local-evidence.mjs`, `node verify-ar-aging.mjs`, `node verify-ap-aging.mjs`, `node verify-invoice-receipt-evidence.mjs`, `node verify-bill-payment-evidence.mjs`, and `node build.mjs` pass. QBO report filters, customizations, row/summary drill semantics, permissions, audit, empty states beyond the observed one, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - GL/TB/BS local report controls and cash scope (2026-08-03)

- A fresh read-only QBO Balance Sheet audit showed Back to standard reports, Report period, From, To, Accounting method (Cash / Accrual), Display columns by, Compare to, Select Period, Customize, Save As, Compact / 100%, Insights, `Balance Sheet`, `As of August 3, 2026`, and the loading state `Balance Sheet report is updating`. No period, method, comparison, customization, save, insight, print, export, email, or data action was invoked.
- Following the Refs助手3-WBS business-fit review, REFS now displays report-control evidence computed from the same scoped POSTED JE sets used by GL, TB, BS, and Cash Flow: TB debit=credit, each GL account balance=TB balance, BS assets=liabilities+equity+net income, cash groups=BS cash, and Operating closing cash=Cash Flow closing cash. These checks use entity, To-period, and Property/Project/Loan scope consistently; the BS remains cumulative through To regardless of From.
- The report surface explicitly separates Total cash, Available Operating cash, and Restricted/escrow/trust/security-deposit/payroll-restricted cash, including mapped account codes. Loan-draw availability is not assumed. All amount drills remain confined to retained POSTED JEs and supported local AP/AR/Bank/PM/Closing sources. External feeds/connectors, cross-company packages, online share/email, Spreadsheet Sync, sales/KPI/forecasting, and payment-processor balances are excluded.
- `node verify-report-control-evidence.mjs`, `node verify-balance-sheet-asof.mjs`, `node verify-cash-account-scope.mjs`, `node verify-cash-flow-evidence.mjs`, and `node build.mjs` pass. QBO actual filters/methods/compare results, live account balances, drill semantics, permissions/audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Reports Center capability boundaries (2026-08-03)

- A fresh read-only QBO Standard reports audit showed Reports & Analytics navigation, Standard / Custom / Management reports, KPIs, Dashboards, Spreadsheet sync, Performance center, Financial planning, Cash flow planner, Budgets, Forecasts, Create new report, Smart reporting promotion, Performance center shortcut, Favorites (A/R aging summary, Balance Sheet, Profit and Loss), Custom report builder, and report names including Inventory Status, Bill Approval Status, Product/Item Profitability by Customer, and Invoice Approval Status. No creation, report run, search, customization, favorite change, save, print, export, sync, dashboard, KPI, or data action was invoked.
- Following the Refs助手3-WBS business-fit review, REFS now assigns every Reports Center row a capability: local ledger workflow, local operational workflow, local preview without source drill, or reference-only/unavailable. Only local workflows can open a destination and preserve local context; reference-only rows are non-clickable, are not favoriteable, and do not claim Ready or drillable. Favorites normalize on reload to available local reports only, preventing stale/dead links.
- Retained local workflows cover financial statements/GL/TB/BS/P&L, AP/AR aging, reconciliation, and scoped property/loan/exception previews. QBO custom/management report creation, print/email/export/share/subscription, external sources/connectors, Spreadsheet Sync, cross-company packs, dashboards/KPIs/forecasting, sales performance/channels, and payment-provider reports remain reference-only or excluded.
- `node verify-report-workflow-targets.mjs`, `node verify-report-favorites.mjs`, `node verify-report-business-scope.mjs`, and `node build.mjs` pass. QBO search/category/favorite persistence and destination semantics, permissions/audit, empty/responsive states, and functional equivalence remain unverified and are not claimed.

## REFS update - In-place General Ledger report drill (2026-08-03)

- User-provided REFS evidence showed a Trial Balance amount drill being appended below the current report, leaving the selected detail off-screen and the action unclear. This is a REFS usability observation, not a claim about an observed QBO drill behavior.
- A report drill now switches the existing General Ledger surface into a dedicated Transaction detail mode instead of rendering below the report. Its existing Back to report/Close controls return to the exact in-memory report state, including the selected tab and filters; no data mutation or external navigation is involved.
- The detail remains limited to the existing scoped POSTED-JE proof set. QBO drill presentation, permissions, audit trail, responsive behavior, and equivalence remain unverified.
- `node verify-gl-drill-state.mjs`, `node verify-report-control-evidence.mjs`, and `node build.mjs` pass.

## QuickBooks read-only evidence & REFS update - Vendor local AP evidence (2026-08-03)

- A fresh read-only QBO Vendors audit showed Expenses & Bills navigation, Pay vendors, New vendor, Unpaid last 365 / Overdue / Open Bills / Paid summaries, and vendor-list columns Vendor, Company name, Phone, Email, 1099 tracking, Open balance, and Action; pagination showed 1–50 of 947. No vendor, bill, payment, filter, page, or export action was invoked.
- Following the Refs助手3-WBS business-fit review, REFS vendor rows now disclose related-party status, entity-scoped posted-proof status, local 1099-review state, and an open balance computed solely from valid retained POSTED AP JEs. Aging drill is enabled only for that proven balance; the same vendor cannot silently aggregate an apparent AP balance across entities.
- Vendor names, phone/email absence, payment terms, tax documents, classifications, property/project defaults, and multi-entity master governance remain incomplete where not retained. 1099 review is only a local possible-review flag requiring exact posted payment and matched-bank source evidence; no form preparation, filing, pay-vendor network, ACH/check execution, OCR, portal, attachment, or external sync is implemented.
- `node verify-vendor-listing.mjs`, `node verify-bill-payment-evidence.mjs`, and `node build.mjs` pass. QBO vendor lifecycle, controls, pagination/search, permissions/audit, responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Customer payment evidence workspace (2026-08-03)

- A fresh read-only QBO Vendors audit reconfirmed the live Expenses shell: Pay vendors, New vendor, unpaid/overdue/open/paid summaries, vendor detail columns, Create bill actions, and 1–50 of 947 pagination. No QBO record, filter, page, export, payment, or vendor was changed. The audit informs native shell comparison only; it is not evidence for customer-payment equivalence.
- Following the Refs助手3-WBS business-fit review, REFS AR now contains a Receipts view that connects retained Invoice → posted receipt JE → exact matched local bank CREDIT. It exposes counterparty, entity evidence, date, amount, receipt-JE drill, bank status, and bank-item drill in the existing AR surface. Views are All, Bank matched, Posted unmatched, and Review.
- A receipt row exists only when an invoice retains a receipt JE. BANK_MATCHED requires a POSTED same-entity receipt that exactly clears the full invoice AR and cash amounts plus a MATCHED CREDIT bank record pointing to that JE. Full local receipts are the only supported action today; partial/split/combined payments, deposits mixed with rent, cross-property/entity receipts, unresolved credits, payment links, cards/ACH, customer portals, processors, sales channels, and external bank connections remain excluded or review-only.
- node verify-customer-payment-evidence.mjs, node verify-invoice-receipt-evidence.mjs, node verify-aging-local-evidence.mjs, and node build.mjs pass. QBO receipt screens, payment allocation behavior, bank-match lifecycle, permissions/audit, empty/responsive states, and functional equivalence remain unverified and are not claimed.

## REFS update - Local reconciliation worksheet scope (2026-08-03)

- The current QBO browser remained on Vendors and was read-only audited before this cycle; it showed the live Expenses vendor shell and no reconciliation interaction was performed. Therefore this implementation is based on retained REFS reconciliation evidence and the Refs助手3-WBS business-fit review, not on a new observed QBO Reconcile screen.
- The local Reconcile surface now makes its worksheet scope explicit: one entity, one mapped bank account and cash scope, period/cutoff, statement beginning/ending balances, cleared/unverified match counts, unhandled bank items, and timing items. It labels the close state and exact blocking reason in place, while preserving the existing guarded sign-off control.
- Reconciliation clearing is presentation/evidence only and does not create/reclassify a JE or change GL/TB/BS. A nonzero/unexplained difference, unverified match, missing mapping, non-operating scope, or prior sign-off remains blocked. Existing adjustment JEs may be inspected but QuickBooks-style quick adjustments, feed/import/OCR, automatic matching, payment actions, escrow/trust/loan-draw mixing, and silent reopening are not implemented.
- node verify-reconciliation-local-evidence.mjs, node verify-bank-reconciliation.mjs, and node build.mjs pass. Formal immutable reconciliation snapshots, reopen/reversal workflow, QBO setup/permissions/audit, empty/responsive states, and functional equivalence remain unverified and are not claimed.

## REFS update - Entity-bound local report scopes (2026-08-03)

- Following the Refs助手3-WBS report-fit review, the local GL/TB/BS/Income Statement/Cash Flow workspace can now save and load a browser-local report scope containing the active entity, report tab, From/To period, and Property/Project/Loan dimensions. A saved scope is available only to the same entity and is rejected when entity or date range is not explicit.
- Loading a scope restores the report context and clears any prior amount drill so all totals and future drills recompute from the same retained entity/period/dimension/POSTED-JE set. The existing control indicators remain the evidence for TB=GL, BS balance, and cash ties; BS remains as-of through the To period.
- The feature deliberately does not create a QBO Custom Report, share/link/email/print/export/subscription, Spreadsheet Sync, external source, cross-company package, sales KPI, dashboard, or payment-channel report. Saving is browser-local scope metadata only and has no accounting effect.
- node verify-report-scope-presets.mjs, node verify-report-control-evidence.mjs, node verify-gl-drill-state.mjs, and node build.mjs pass. QBO report-save behavior, entity selector semantics, audit/permissions, empty/responsive states, and functional equivalence remain unverified and are not claimed.

## REFS update - Entity-scoped local cash register (2026-08-03)

- A read-only QBO Vendors audit again observed the vendor master shell (summary cards, Vendor/Company/Phone/Email/1099/Open Balance/Action columns, Create bill rows, and 1–50 of 947 pagination). No QBO data or navigation action was changed; no QBO Account Register behavior was observed in this cycle.
- Following the Refs助手3-WBS business-fit review, REFS Account Register now limits its selectable accounts to locally mapped cash GLs for the active entity. It refuses to show an all-entity register, displays the mapped bank account/cash-scope proof, and scopes bank evidence to that same entity and cash GL. Out-of-scope bank evidence is exposed as review rather than silently treated as cleared.
- The existing register continues to show POSTED-JE date/source/dimensions/debit/credit/running balance and routes to GL/JE/local source; Run Report now opens same-account GL Detail context through the selected cutoff. Operating, escrow/restricted, and loan-draw cash remain separated. Bank match is not reconciliation sign-off; opening balances, timing items, trust ownership, and formal GL/TB/BS balance certification remain gaps.
- node verify-account-register-evidence.mjs, node verify-gl-dimension-scope.mjs, and node build.mjs pass. QBO register editing/feed/download/reconciliation status, audit/permissions, empty/responsive states, and functional equivalence remain unverified and are not claimed.

## REFS update - Local journal posting evidence (2026-08-03)

- Following the Refs助手3-WBS business-fit review, the JE detail workspace now displays local posting evidence: posted/balanced state, debit/credit totals, retained-source state, real-estate dimension state, and retained-history state. The panel is explicitly read-only and does not call an external audit service or claim immutable history.
- A source document is identified only when a retained local source document exists. Manual entries without one remain source-unverified; non-posted and out-of-balance JEs remain visible as such. CWIP, restricted/escrow cash, and capitalized-interest lines without Property/Project/Loan evidence now produce an in-place review warning instead of implying a drill.
- Existing JE/GL/source routes remain usable only where a retained route exists. QBO edit/delete/copy semantics, automatic adjustments, external attachments/OCR/audit sharing/export, full reversal-chain validation, cross-entity JE resolution, and multi-dimension allocation lineage are not implemented or verified.
- node verify-journal-posting-evidence.mjs, node verify-gl-source-target.mjs, and node build.mjs pass. QBO JE detail, history/approval immutability, permissions, empty/responsive states, and functional equivalence remain unverified and are not claimed.

## REFS update - Local asset/CWIP subledger evidence (2026-08-03)

- A further read-only QBO Vendors audit again showed the vendor summary cards, Vendor/Company/Phone/Email/1099/Open Balance/Action columns, Create bill actions, and paginated master list. No asset, vendor, bill, payment, navigation, or export action was performed; this cycle has no direct QBO Fixed Assets evidence.
- Following the Refs助手3-WBS business-fit review, the former static Fixed Assets shell is now an entity- and cutoff-scoped local asset subledger. It aggregates only POSTED asset/CWIP/capitalized-interest JE lines, keeps property/project/loan dimensions and source-JE counts, and drills to the same-account GL detail. CWIP is visibly marked not depreciated; in-service balances are labelled basis-review rather than assigned a depreciation conclusion.
- The interface explicitly holds depreciation and disposal chains empty until retained useful-life/in-service/accumulated-depreciation/disposal/proceeds/reversal evidence exists. No valuation, tax depreciation, capitalization transfer, disposal, external asset source, tag/mobile inventory, or import/export sync is implemented.
- node verify-asset-subledger-evidence.mjs, node verify-report-control-evidence.mjs, and node build.mjs pass. Formal asset register, GL/TB/BS certification, QBO assets behavior, permissions/audit, empty/responsive states, and functional equivalence remain unverified and are not claimed.

## REFS update - AP/AR Aging to GL control reconciliation (2026-08-03)

- A new read-only QBO Vendors audit observed the same visible vendor shell: unpaid/overdue/open/paid summaries, master columns, per-row Create bill action, and no altered data. It is Expenses-shell evidence only; no QBO aging report action or result was inferred from it.
- Following the Refs助手3-WBS business-fit review, both local AP and AR Aging now reconcile their whole retained entity/report-date scope to their source control evidence and same-scope POSTED GL control account. The UI exposes Aging detail, source AP/AR control, posted GL 291001/120200, and two explicit tie-or-review difference rows. AP vendor filtering affects display only and never redefines the GL control total.
- The reconciliation uses credit-normal AP and debit-normal AR signs. It does not create an adjustment or silently force a tie. Draft/pending/paid/void/reversed/unsupported partial, cross-entity, trust/deposit, missing-source, and missing-dimension balances remain excluded or surface as a difference; no collections, reminders, payment links, external credit/bank connection, or export is implemented.
- node verify-aging-local-evidence.mjs, node verify-ar-aging.mjs, node verify-ap-aging.mjs, and node build.mjs pass. Full payment allocation/void/reversal behavior, QBO report controls, permissions/audit, empty/responsive states, and functional equivalence remain unverified and are not claimed.

## REFS update - Local unapplied customer-payment exceptions (2026-08-03)

- A fresh read-only QBO Vendors audit again showed the Expenses vendor shell: Pay vendors, New vendor, unpaid/overdue/open/paid summary cards, Vendor/Company/Phone/Email/1099/Open Balance/Action columns, Create bill actions, and 1–50 of 947 pagination. No customer payment, bill, bank transaction, filter, page, export, or data action was invoked. This is shell evidence only and is not evidence for QBO payment-allocation equivalence.
- Following the Refs assistant3-WBS business-fit review, the existing local AR Receipts surface now also exposes a retained posted-cash-receipt exception queue. It separates exact full invoice allocation, partial-allocation review, unapplied AR cash review, and unapplied prepayment review; every row retains receipt JE, entity, counterparty, invoice reference when present, cash/applied/unapplied amounts, and exact bank-match state. The queue is in the current AR workspace, so the user can return to the report without a below-page append or external navigation.
- This is evidence and review UI, not a payment-allocation engine: it neither applies cash to an invoice nor changes AR/prepayment/GL. Only the previously supported exact full receipt is treated as allocated. Partial/split/combined payments, invoice remaining-balance calculation across allocations, deposits/agency or trust treatment, tenant/unit/property allocation where absent from retained evidence, duplicate detection, cross-entity allocation, refund/reversal, payment links/processors/portals, bank feeds, and external sync remain unimplemented or review-only.
- `node verify-unapplied-customer-payment-evidence.mjs`, `node verify-customer-payment-evidence.mjs`, `node verify-aging-local-evidence.mjs`, and `node build.mjs` pass. QBO receipt/allocation lifecycle, settlement, filters, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified and are not claimed.

## QuickBooks read-only evidence & REFS update - Reconcile scope and report handoff (2026-08-03)

- A fresh read-only QBO Reconcile audit showed the Accounting navigation entry, the Reconcile page introduction `Match the books to the bank records`, connected-accounts message, Connect now, Video tutorials, Keep yourself on track / Find holes in your accounting / Get things tidy for tax time, and Get started. No account connection, setup, tutorial, reconciliation, import, match, adjustment, sign-off, export, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, the local reconciliation worksheet now explicitly moves only through Draft (missing retained mapping/cutoff), In review, Balanced, and Signed off. It shows retained entity, bank account, cash scope, statement cutoff/beginning/ending, locally-matched versus unverified proof, timing/unhandled counts, and adjusted bank/book/difference. A MATCHED bank item is explicitly not presented as cleared or signed off.
- From the worksheet, GL Detail, Trial Balance, AR Aging, and AP Aging handoffs are enabled only when the currently active entity exactly matches the retained reconciliation entity. Statement period/cutoff and cash account drill context are passed forward; AP/AR accept the explicit aging tab/cutoff. No handoff creates a JE or changes GL/TB/Aging; local sign-off remains the existing zero-difference/all-activity guarded action.
- QuickBooks reconciliation adjustment entry, feed/statement import, automatic matching/AI, non-operating escrow/trust/security-deposit mixing, external audit sharing/export, and payment/sales channels are excluded. Formal immutable statement snapshots, clearing-state persistence independent of bank match, cross-period timing ownership, and QBO lifecycle/permissions/audit/empty/responsive behavior remain unverified and are not claimed.
- `node verify-reconciliation-local-evidence.mjs`, `node verify-bank-reconciliation.mjs`, `node verify-aging-local-evidence.mjs`, and `node build.mjs` pass.

## REFS update - Unmatched bank-credit receipt evidence (2026-08-03)

- This scoped continuation uses the same fresh read-only QBO Reconcile observation recorded above and the Refs assistant3-WBS business-fit review; no QBO Bank transactions row, match, categorization, reconciliation, connection, import, export, or business-data action was invoked in this implementation step. It therefore makes no new claim about QBO Bank transactions behavior.
- REFS Bank transactions now shows an `Unmatched customer receipt exceptions` review queue for retained unmatched bank CREDITs. It preserves bank item/date/amount/account, entity/cash scope, exact local posted receipt/prepayment candidate when one exists, candidate property/project/counterparty where retained, and a separate `UNMATCHED` / `INVESTIGATING` / `HELD_AS_UNAPPLIED` state. Exact candidate evidence opens only a JE drill; it is never automatically matched, allocated, posted, cleared, or signed off.
- Missing bank master, non-operating cash scope, same-amount multiple candidates, and no exact local receipt/prepayment candidate are held explicitly. AR Aging and Reconcile review handoffs retain local context; AR aging is disabled until the active entity equals the bank-master entity. Escrow/restricted/security-deposit, owner/related-party receipts, absent property/unit, cross-entity receipts, and bank-day/accounting-day differences remain review boundaries rather than automatic classification.
- There is no allocation engine, no AR/prepayment/GL/TB/Aging mutation, no external feed/import/OCR/AI, no payment link/channel, and no export/collaboration. QBO candidate search/matching, exception lifecycle, clearing persistence, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified and are not claimed.
- `node verify-unidentified-receipt-evidence.mjs`, `node verify-bank-transaction-evidence.mjs`, `node verify-unapplied-customer-payment-evidence.mjs`, and `node build.mjs` pass.

## QuickBooks read-only evidence & REFS update - Unmatched bank-debit disbursement evidence (2026-08-03)

- A fresh read-only QBO Bank transactions audit showed account cards with account name, pending count, Bank balance, Posted balance, and date; Update accounts, Link account, Go to bank register; Review / Posted / Excluded queues; Search; Filter by Date; Transaction types; 1–50 of 401 pagination (Page 1 of 9); Print, Export to CSV, Settings; and table headers Date, Bank description, Spent, Received, Attach file, From/To, Match/Categorize, Action. No account, transaction, filter, page, match, category, post, exclude, attachment, print, export, settings, or connection action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS Bank transactions now has an `Unmatched disbursement exceptions` queue for retained unmatched bank DEBITs. It preserves item/date/amount/account, entity/cash scope, exact retained local AP-payment/expense/CWIP candidate when one exists, property/project/payee where retained, and a distinct `UNMATCHED` / `INVESTIGATING` / `HELD_UNEXPLAINED` state. The only available evidence drill is to an existing local JE, AP Aging (only for a matching active entity), or Reconcile review.
- A same-amount candidate is not a classification, match, post, clearance, or sign-off. Missing bank master, non-operating/escrow/restricted cash, same-amount multi-candidates, no exact candidate, capitalized-vs-expense, prepaid/tax/insurance, related-party, loan, missing property/project, and cross-entity cases remain held for manual decision. This queue neither writes a JE nor changes Bank/GL/TB/AP Aging/Reconcile data.
- QBO feed/statement import, automatic categorization/matching/posting/AI, attachment capture, online payment/vendor connection, external sync/export, lifecycle, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified or excluded and are not claimed.
- `node verify-unidentified-disbursement-evidence.mjs`, `node verify-unidentified-receipt-evidence.mjs`, `node verify-bank-transaction-evidence.mjs`, and `node build.mjs` pass.

## REFS update - Local reconciliation reopen/correction workflow (2026-08-03)

- This scoped implementation relies on the fresh, read-only QBO Bank transactions observation recorded above and the Refs assistant3-WBS business-fit review. No QBO reconcile record, bank transaction, account, adjustment, sign-off, export, or other business data was altered; QBO reopen behavior was not observed and is not claimed.
- A locally signed reconciliation now retains a snapshot of difference, source bank-item ids, statement cutoff/ending balance, and book balance. The REFS worksheet can request a correction reason, then expose `SIGNED_OFF → REOPEN_REQUESTED → REOPENED | REOPEN_REJECTED`; only the existing local reconciliation workflow metadata changes. Journal entries, bank item matching, GL, TB, and Aging remain read-only POSTED evidence.
- Reopening never overwrites the signed snapshot or silently clears/rechecks activity. A reopened period must pass the current zero-difference, local mapping, and source-proof gates before a new sign-off; the existing snapshot, reason, requester, and reviewer remain visible. Restricted/escrow/trust cash and timing/receipt/deposit risks continue to be scope/review boundaries.
- QBO automatic adjustment entries, feed/statement import, auto-match/posting, payment/sales channels, external audit sharing/export, immutable history semantics, lifecycle/permissions/empty/responsive behavior, and functional equivalence remain unverified or excluded and are not claimed.
- `node verify-reconciliation-reopen-evidence.mjs`, `node verify-bank-reconciliation.mjs`, `node verify-reconciliation-local-evidence.mjs`, and `node build.mjs` pass.

## QuickBooks read-only evidence & REFS update - Invoice void/reversal proof boundary (2026-08-03)

- A fresh read-only QBO Invoices audit showed Sales & Get Paid navigation with Overview, Sales transactions, Invoices, Payment links, Recurring payments, Sales orders, Sales channels, QuickBooks payouts, and Products & services. The current invoice page showed a Payments promotion, Create invoice, Compare rates, and resources for recording a customer payment or creating/sending invoices. No invoice, payment, link, recurring payment, channel, payout, product, rate comparison, filter, export, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, the selected local Invoice evidence panel now exposes a retained void/reversal state. A local source must exist and be POSTED; its retained POSTED reversal is separately drilled and the original document remains visible. An unpaid posted source is merely `VOID_ELIGIBLE_REVIEW` evidence, not a mutation path.
- Any local receipt, matched bank item, missing/unposted source, ambiguous reversal, or missing payment reversal blocks direct void. AR Aging continues to calculate only its existing retained OPEN/posted proof set; this change never deletes an invoice/payment, creates a reversal/refund, changes unapplied cash, or changes Bank/GL/TB/Aging data. Prepayments/deposits, partial/cross-period/cross-entity items remain exception/reopen review boundaries.
- Online invoice payments, payment links, cards/ACH, customer portal, recurring sales, channels/payouts, auto-collections/auto-posting, external connections, QBO void/refund behavior, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified or excluded and are not claimed.
- `node verify-invoice-void-evidence.mjs`, `node verify-invoice-receipt-evidence.mjs`, `node verify-ar-aging.mjs`, and `node build.mjs` pass.

## QuickBooks read-only evidence & REFS update - Bill/vendor-payment void/reversal proof boundary (2026-08-03)

- A fresh read-only QBO Bills audit showed Expenses & Bills navigation (Expense transactions, Vendors, Bills, Bill payments, Contractors, 1099s), Bills, Pay bills, Add bill, How to manage bills, For review / Unpaid / Paid / Recurring (NEW), Bill Date (`This Year`, 01/01/2026–12/31/2026), Print, Export, Customize, and a 0–0 of 0 items / Page 1 of 1 empty state. No bill/payment/filter/print/export/customization/recurring or business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, local Bill detail now exposes posted AP/payment/reversal evidence. The original bill and AP/payment JEs remain retained; a retained POSTED AP reversal has its own JE drill. A posted unpaid AP source is only `VOID_ELIGIBLE_REVIEW` evidence and cannot create a reversal through this UI.
- Existing payment, matched bank debit, missing/unposted AP source, ambiguous reversal, or missing payment reversal blocks direct void. AP Aging retains its existing posted/open proof calculation; this addition never deletes a bill/payment, refunds/pay vendors, creates a reversal, changes bank matching, or mutates AP/CWIP/expense/GL/TB/Aging. Paid/partial, prepaid/CWIP, related-party, restricted/escrow/loan, cross-entity, and signed-reconciliation cases remain exception/reopen review boundaries.
- QBO Bill Pay, check/ACH/card execution, vendor portal, feed/attachment/import, auto-match/posting, QBO void/refund behavior, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified or excluded and are not claimed.
- `node verify-bill-void-evidence.mjs`, `node verify-bill-payment-evidence.mjs`, `node verify-ap-aging.mjs`, and `node build.mjs` pass.

## QuickBooks read-only evidence & REFS update - Local report dimension-scope evidence (2026-08-03)

- A fresh read-only QBO Reports audit showed Create new report, Smart reporting messaging, Review Summary, Performance center/View dashboard, Favorites for Accounts receivable aging summary, Balance Sheet, and Profit and Loss, plus Custom report builder examples (Inventory Status, Bill Approval Status, Product/Item Profitability by Customer, Invoice Approval Status). No report creation, favorite change, customization, summary/dashboard action, print, export, or business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS GL/TB/BS report controls now expose local scope evidence beside the active entity/property/project/loan scope: count of in-scope posted lines, missing-dimension lines, cross-scope lines, and entity-mismatch lines. A `LOCAL_SCOPE_REVIEW` state makes exclusions visible instead of silently consolidating them.
- The existing same-scope TB=GL, BS as-of through To, cash-scope, and AR/AP control evidence remains unchanged. The added scope evidence neither assigns a missing dimension nor changes a journal/report total; out-of-scope lines are excluded until retained entity/property/project/loan assignment evidence exists. Cross-entity/shared-cost/opening-balance/loan/restricted-cash issues remain review boundaries, not inferred allocations.
- QBO custom/management report behavior, cross-company consolidation, Spreadsheet Sync, dashboard/KPI operations, exports/connections, automatic reclassification/posting, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified or excluded and are not claimed.
- `node verify-dimension-scope-evidence.mjs`, `node verify-gl-dimension-scope.mjs`, `node verify-report-control-evidence.mjs`, and `node build.mjs` pass.

## QuickBooks read-only evidence & REFS update - Local bank-to-bank transfer evidence (2026-08-03)

- A fresh read-only QBO Bank transactions audit showed transaction rows with Attachments, AI recommendations, Match/Categorize, Post, and pagination (1–50 of 401); prior same-page observations recorded account cards, Review/Posted/Excluded, filters, print/export/settings, and core columns. No attachment, AI recommendation, match, categorize, post, page/filter, export, or business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS Bank transactions now exposes two-sided local bank-transfer evidence. A row becomes confirmed only when opposite-direction retained MATCHED bank rows are same entity, same amount, different accounts, reference one POSTED local Transfer JE, and originate in Operating cash scope. The UI preserves both accounts/scopes, amount, JE drill, and a hold reason.
- Confirmed internal transfers are explicitly excluded from operating/investing/financing cash-flow classification; total cash remains a balance-sheet control rather than new income/expense. Cross-entity, escrow/restricted, loan-draw, unpaired, same-amount ambiguous, and non-posted JE candidates remain held; the view cannot initiate a transfer, pair rows, change bank matching, post a JE, or mutate reports/reconciliation.
- QBO transfer creation, feed/attachment/AI/post behavior, external connections, cash-flow classification, cross-company consolidation, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified or excluded and are not claimed.
- `node verify-bank-transfer-evidence.mjs`, `node verify-bank-transaction-evidence.mjs`, and `node build.mjs` pass.

## QuickBooks read-only evidence & REFS update - Local bank duplicate-posting boundary (2026-08-03)

- A further read-only QBO Bank transactions audit confirmed visible Review rows with Attachments, Start a conversation, AI recommendations, counterparty suggestion, Match/Categorize, Post, and 1–50 of 401 pagination. No attachment, conversation, AI suggestion, match, category, post, page, export, or business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS now derives duplicate evidence from the retained same entity + same bank account + same external bank identifier. If another retained row with that identifier already points to a POSTED JE, the new row is visibly `DUPLICATE REVIEW` and Match/Categorize acceptance is blocked. All records remain retained for audit review.
- Amount alone never identifies a duplicate: periodic rent, installments, supplier batches, and cross-account transfers require identifier/entity/account/source evidence. The boundary never deletes, reverses, excludes, posts, matches, or changes a bank row/JE/GL/TB/Aging/cash flow/reconciliation; it only blocks an additional local acceptance pending review.
- Bank-feed deduplication, external dedup service, automatic reversal/posting, QBO duplicate semantics, payment/sales channels, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified or excluded and are not claimed.
- `node verify-bank-duplicate-evidence.mjs`, `node verify-bank-transaction-evidence.mjs`, and `node build.mjs` pass.

## QuickBooks read-only evidence & REFS update - Vendor credit application evidence (2026-08-03)

- A fresh read-only QBO Bills audit showed Expenses & Bills navigation (Expense transactions, Vendors, Bills, Bill payments, Contractors, 1099s), Bills, Pay bills, Add bill, `How to manage bills`, For review / Unpaid / Paid / Recurring (NEW), Vendor and Bill Date filters, Print, Export, Customize, the columns Vendor / Due Date / Bill Amount / Open Balance / Status / Action, and the `No bills found` 0–0 empty state. No bill, vendor, payment, receipt upload, filter, print, export, customization, or other business-data action was invoked. Vendor-credit creation/application behavior was not observed.
- REFS now presents a local `Vendor credit application evidence` table in the existing Bills workspace rather than appending a detail beneath a report. It reads only retained `AP_CREDIT` journals, drills to their retained JE or linked local bill, and exposes credit amount, explicit application amount, entity, and state.
- A credit must be POSTED, debit AP control 291001, link a retained open bill in the same entity, and carry an explicit positive application no greater than both the credit and bill amount before it is marked `APPLIED_CREDIT_EVIDENCE`. Missing linkage, wrong AP direction, missing/closed bill, cross-entity, over-application, and unposted sources remain visible review states. Unapplied/review rows never reduce AP Aging.
- This is a proof boundary, not a vendor-credit workflow: it creates no credit, refund, vendor payment, bill change, JE, allocation, bank match, or reconciliation change. Even applied evidence does not yet update AP Aging/GL until a retained subledger allocation is independently reconciled. Capitalized/CWIP, prepaid, related-party, trust/escrow/restricted cash, cross-period, and cross-entity cases remain manual review; QBO Bill Pay, refunds, OCR/attachments, feeds, external connections, exports, permissions/audit, responsive states, and functional equivalence are unverified or excluded.
- `node verify-vendor-credit-evidence.mjs`, `node verify-ap-aging.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Applied vendor credit in AP Aging (2026-08-03)

- A fresh read-only QBO Bill payments audit showed the Expenses & Bills navigation, `Bill payments` heading, an information control stating that the page displays only payments made through QuickBooks Bill Pay, and `Pending approval` / selected `Payments` tabs. No tab data, payment, approval, bill, bank action, export, or other business-data action was invoked. QBO vendor-credit application and AP Aging behavior were not observed.
- REFS AP Aging now presents the retained original bill amount, explicitly applied local vendor-credit amount, and calculated open amount in the current report view. It reduces only a linked open local bill where the credit evidence is POSTED, AP-control debit direction is valid, entity and vendor agree, explicit applied amount is positive and within the credit/bill cap, and the aggregate applied credit is not above the bill amount.
- Unapplied, unposted, missing-bill, wrong-direction, vendor-mismatch, cross-entity, closed-bill, and individual/aggregate over-limit credits remain review-only and never reduce AP Aging. The existing AP Aging → posted GL control reconciliation intentionally continues to surface any unmatched source/GL difference rather than forcing a tie.
- The change neither creates nor applies a credit, edits a bill, produces a JE/refund/vendor payment, changes bank matching/reconciliation, or reclassifies CWIP/prepaid/related-party/trust/escrow/restricted-cash items. Property/project dimension agreement for credits, multi-bill allocation, cross-period allocation, immutable allocation audit trail, QBO Bill Pay/refund behavior, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified or excluded.
- `node verify-vendor-credit-evidence.mjs`, `node verify-ap-vendor-credit-aging.mjs`, `node verify-ap-aging.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Real-estate vendor-credit scope and audit gates (2026-08-03)

- A fresh read-only QBO Bills audit showed the Expenses & Bills navigation, Bills, Pay bills, Add bill, receipt-autofill/email promotion, How to manage bills, For review / Unpaid / Paid / Recurring, Vendor and Bill Date filters, Print/Export/Customize, resizable Vendor/Due Date/Bill Amount/Open Balance/Status/Action columns, and the 0–0 `No bills found` empty state. No bill, receipt upload/email, payment, filter, print, export, customization, or other business-data action was invoked. QBO vendor-credit lifecycle, application, audit, and dimension behavior remain unobserved.
- Following the Refs assistant3-WBS business-fit review, local vendor-credit evidence now retains credit/bill source JEs, entity, supplier identity, property/project values when retained, application amount, and source audit-history state. The existing Bills table presents these in its current workspace with direct retained JE/bill drills rather than a below-report append.
- AP Aging reduction is now blocked not only for unposted/unapplied/over-limit/cross-entity credits, but also for supplier mismatch, declared property/project mismatch, related-party credit lacking reason plus approval history, and capitalized-CWIP or prepaid credit lacking original source-document evidence. These cases remain explicit review rows; no property/project allocation is inferred.
- The implementation is a local review/aging calculation only: it does not create/approve/post/apply/void a credit, bill, refund, payment, source document, or JE; it does not change bank matching, reconciliation, GL/TB, or any real QBO data. Multi-bill/partial/cross-period allocation, exact bill-unpaid-after-payments cap, immutable approval/application history, QBO permissions/audit/empty/responsive behavior, and functional equivalence remain unverified or unimplemented. Bill Pay, external refunds, OCR/attachments, feed/connections, and exports are excluded.
- `node verify-vendor-credit-evidence.mjs`, `node verify-ap-vendor-credit-aging.mjs`, `node verify-ap-aging.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Bill payment balance before vendor-credit application (2026-08-03)

- A fresh read-only QBO Bill payments audit showed the Expenses & Bills navigation, `Bill payments` heading, the information control that this page displays only payments made through QuickBooks Bill Pay, `Pending approval` / selected `Payments` tabs, a `Filters` control, `Payment date: All dates`, and the Bill Pay empty-state message. No filter, approval, payment, bill, bank, export, or other business-data action was invoked. QBO payment allocation/open-balance behavior was not observed.
- Following the Refs assistant3-WBS business-fit review, REFS now calculates an eligible local bill balance through the selected report date as retained POSTED bill amount less retained same-entity/same-supplier payment JE AP debits less explicitly applied local credit. Payment JE date controls as-of inclusion; bank matching is retained audit evidence but not a prerequisite to recognizing a valid posted local AP payment.
- The current AP Aging table exposes Bill amount, Paid, Applied credit, and Open amount. Credit application is blocked if it exceeds the credit or the bill balance after qualifying local payments; aggregate applied credits cannot produce a negative balance. Future-dated credits do not reduce an earlier report date.
- Partial/multiple payment records are only accepted when retained journal references exist and their AP debit/cash evidence is internally valid. Payment reversals/voids, exact historical document status, multi-bill allocations, cross-period payment reversal, property/project consistency for payment JEs, immutable approval/application history, and QBO lifecycle/permissions/audit/empty/responsive behavior remain unverified or incomplete. No Bill Pay network action, bank mutation, refund, feed, attachment/OCR, connector, or export is implemented.
- `node verify-vendor-credit-evidence.mjs`, `node verify-ap-vendor-credit-aging.mjs`, `node verify-bill-payment-evidence.mjs`, `node verify-ap-aging.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Retained bill-payment reversal cutoff boundary (2026-08-03)

- A fresh read-only QBO Bill payments audit showed Expenses & Bills navigation, `Bill payments`, the control stating that the page displays only payments made through QuickBooks Bill Pay, and `Pending approval` / selected `Payments` tabs. No payment, approval, filter, bill, bank, export, or other business-data action was invoked. QBO payment void/reversal, bank-match, reconciliation-lock, and historical-aging behavior were not observed.
- Following the Refs assistant3-WBS business-fit review, local AP payment proof now reads a retained POSTED payment JE and separately retains its exact POSTED reversal JE. Before the reversal effective date the valid payment reduces AP; from that date it restores the local bill balance. The AP Aging row exposes the local payment-proof state alongside bill, paid, credit, and open amounts.
- A matched bank row or signed-off bank indication blocks automatic restoration and yields `PAYMENT_REVERSAL_BANK_REVIEW`; the original payment/bank evidence remains intact. This deliberately avoids deleting/rebuilding bank items, silently voiding a payment, or treating a bank match as an accounting reversal. Missing/wrong-entity/wrong-vendor/non-exact reversals remain review states.
- CWIP/prepaid source restoration, property/project equality on payment/reversal, related-party reason/approval, signed-reconciliation reopen linkage, multiple or partial reversals, cross-period controls, exact GL/TB/AP-control recomputation, QBO lifecycle/permissions/audit/empty/responsive behavior, and functional equivalence remain unverified or incomplete. No refund, Bill Pay/network action, bank/reconcile mutation, feed, attachment/OCR, connector, or export is implemented.
- `node verify-bill-payment-reversal-evidence.mjs`, `node verify-vendor-credit-evidence.mjs`, `node verify-ap-vendor-credit-aging.mjs`, `node verify-bill-payment-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Customer-receipt reversal cutoff boundary (2026-08-03)

- A fresh read-only QBO Invoices audit showed Sales & Get Paid navigation (Overview, Sales transactions, Invoices, Payment links, Recurring payments, Sales orders, Sales channels, QuickBooks payouts, Products & services) and the current Payments promotion: Create instantly payable invoices, card/ACH/wallet options, Create invoice, Compare rates, and tips for recording a customer payment. No invoice, customer payment, payment-link/channel/payout, rate, filter, export, or other business-data action was invoked. Those payment-network features are excluded from REFS.
- Following the Refs assistant3-WBS business-fit review, REFS now derives a retained local receipt balance and reversal state for AR Aging. A same-entity/same-customer/same-property-project, POSTED cash-to-AR receipt reduces an OPEN local invoice only through its report cutoff; an exact POSTED reversal restores the invoice balance on/after its effective date. The current AR Aging table displays invoice amount, received, receipt proof, and open amount.
- Deposits, prepayments, security deposits, escrow/trust/restricted-cash-like accounts, customer/entity/property-project mismatches, related-party receipts without reason plus approval history, and bank-matched receipt reversals do not auto-allocate/restore AR. A bank-matched reversal remains `RECEIPT_REVERSAL_BANK_REVIEW`; original receipt JE and bank evidence remain retained.
- This is read-only local accounting evidence: it does not create/send/collect/refund/void a QBO invoice or payment; does not alter bank items/reconciliation/GL/TB; and does not enable payment links, cards/ACH, channels, wallets, payouts, external sync, or exports. Multi-invoice/split allocation, AR credits, signed-reconciliation reopen linkage, full property/unit master proof, historical invoice status, GL/TB same-scope recomputation, QBO permissions/audit/empty/responsive behavior, and functional equivalence remain unverified or incomplete.
- `node verify-customer-receipt-reversal-evidence.mjs`, `node verify-ar-aging.mjs`, `node verify-invoice-receipt-evidence.mjs`, `node verify-unapplied-customer-payment-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - AP/AR control-account difference evidence (2026-08-03)

- A fresh read-only QBO Chart of accounts audit showed Accounting navigation (Bank transactions, Integration transactions, Receipts, Reconcile, Rules, Chart of accounts, Recurring transactions, Revenue recognition, Fixed assets, Prepaid expenses, My accountant, Intuit Experts), Chart of accounts, All lists, Run report, New account/menu, Batch actions/edit, name/limit filters, Print/Settings, account table columns, per-account Run report, and pagination (Showing accounts 1 to 200). No account, batch, report, filter, print, export, settings, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, AP Aging and AR Aging now expose an in-place control-difference evidence panel when retained review evidence exists. It carries AP/AR scope via the active entity/as-of date, category, amount, reason, and a direct local JE drill when a retained JE exists; it does not append detail beneath a separate report or default missing evidence to tied.
- The current classifier makes nonzero aging-to-source/GL deltas explicit, identifies retained manual/unmodeled control-account JEs, and shows bank-matched reversal review even if its total has not been adjusted. It does not auto-adjust, reclassify, consolidate entities, or suppress a variance. Missing drill evidence remains visibly unavailable.
- CWIP/prepaid asset-source credits, deposits/security deposits/escrow/trust/restricted cash, related-party approvals, cross-entity/property/project conflicts, unapplied receipts/credits, partial/cross-period applications, signed reconciliation state, and unsupported source documents remain review boundaries. Full GL/TB recomputation by property/project, QBO report behavior, permissions/audit, empty/responsive behavior, and functional equivalence remain unverified or incomplete; external bank/payment/feed/OCR/connector/export actions are excluded.
- `node verify-aging-control-difference-evidence.mjs`, `node verify-aging-local-evidence.mjs`, `node verify-ap-vendor-credit-aging.mjs`, `node verify-customer-receipt-reversal-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - GL/TB to AP/AR same-scope control bridge (2026-08-03)

- A fresh read-only QBO Reports audit showed the Reports & Analytics navigation: Standard reports, Custom reports, Management reports, KPIs, Dashboards, Spreadsheet sync, Performance center, Cash flow planner, Budgets, and Forecasts. The report center favored A/R Aging Summary, Balance Sheet, and Profit and Loss. A read-only A/R Aging Summary view showed the as-of date control, Customize, Save As, Compact, refresh, Email/Print/Export/More actions, report-ready status, and the `Your selection doesn't have any info` empty state. No report was saved, customized, refreshed, emailed, printed, exported, or otherwise changed.
- Following the Refs assistant3-WBS business-fit review, the REFS GL/TB report now computes AP 291001 and AR 120200 aging-control comparisons from the same retained entity, as-of cutoff, property/project scope, and POSTED JE set as the current GL/TB page. The current page displays aging / GL amounts and scoped exception rows directly in the report; retained JE evidence remains a direct drill target.
- The bridge classifies and retains only local review evidence (including aging-to-source/GL deltas, unmodeled posted manual control JEs, and bank-matched reversal review). It never makes an adjusting entry, allocates a receipt/credit, changes a Bill/Invoice/Payment/Receipt, posts a JE, or alters bank/reconcile evidence.
- The report center's custom/management/KPI/dashboard/planning, Spreadsheet sync, email/print/export, external connections, sales metrics, and payment collection features are not adopted for the real-estate workflow. Full QBO report customization/filter persistence, permissions/audit behavior, responsive behavior, all AP/AR partial/cross-period/related-party/CWIP/prepaid/deposit exceptions, and functional equivalence remain unverified or incomplete.
- `node verify-aging-gl-tb-bridge-evidence.mjs`, `node verify-aging-control-difference-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Bank/Reconcile to GL/TB evidence bridge (2026-08-03)

- A fresh read-only QBO Reconcile audit showed Accounting's Reconcile route with the `Match the books to the bank records` onboarding shell, `Connect now`, video tutorials, and `Get started`. No account connection, reconciliation setup, bank action, transaction match, sign-off, export, or other business-data action was invoked. QBO item clearing, statement workflow, reconciliation history, permissions, and audit behavior were not observed.
- Following the Refs assistant3-WBS business-fit review, REFS GL/TB now surfaces retained same-entity/as-of/property/project local bank evidence alongside its AP/AR control bridge. Each row displays bank account/date, `matched`, `cleared`, and `signed off` independently, with retained JE and local Reconcile-review drills in the current report interface.
- A matched item must retain a compatible POSTED cash JE; amount/direction, entity, operating-cash scope, statement cutoff, and selected property/project scope must agree. Missing/unposted JEs, cash mismatch, non-operating cash, out-of-scope dimension, post-cutoff bank date, and reopened-without-audit history remain explicit review states. No state is inferred from another.
- This is evidence-only: it does not connect a bank, import a feed/statement, auto-match/clear/sign-off, reopen/reconcile, write an adjustment, post a JE, alter AP/AR aging, or change QBO data. Escrow/trust/restricted cash, loan draws, deposits, related-party and cross-period cash remain separate review boundaries; QBO equivalence is unverified.
- `node verify-reconciliation-gl-tb-bridge-evidence.mjs`, `node verify-reconciliation-local-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - GL/TB retained-scope return path (2026-08-03)

- A fresh read-only QBO Standard reports audit showed the Reports & Analytics shell (Standard/Custom/Management reports, KPIs, Dashboards, Spreadsheet sync, Performance center, planner, Budgets, Forecasts), report search/create controls, Favorites (A/R Aging Summary, Balance Sheet, Profit and Loss), a custom-report-builder promotion, and Inventory/Bill-approval/Customer-profitability/Invoice-approval report links. No report creation, favorite change, customization, search, save, export, email, print, or data action was invoked. Trial Balance and GL Detail runtime behavior remain unobserved.
- Following the Refs assistant3-WBS business-fit review, a local GL/TB report now passes its visible tab, From/To, property, project, loan, and retained account drill selection into JE and Reconcile review navigation. Both destination screens expose an in-place `Back to … report` action returning to that exact local report scope instead of silently resetting to a global report.
- GL Detail/TB empty states continue to derive only from retained POSTED local evidence within the selected scope. Missing source, missing/cross-scope dimensions, and absent Bank/Reconcile evidence remain visible local review/empty conditions; no synthetic rows or Ready state are generated.
- This is local browser-state continuity, not a QBO saved/custom/shared report. QBO permissions/audit, custom-report collaboration, email/print/export, Spreadsheet sync, external connections, Sales KPI/dashboard behavior, and mobile/responsive interaction remain unverified or excluded. Report views remain read-only; no JE/bank/AP/AR operation is created or changed.
- `node verify-report-return-context.mjs`, `node verify-reconciliation-gl-tb-bridge-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## REFS interaction correction - Report drill replaces report view (2026-08-03)

- Following the user interaction requirement and the Refs assistant3-WBS business-fit review, GL/TB amount and total drills now normalize both TB-row objects and statement account-code strings before selecting a detail scope. The clicked report is replaced by a dedicated transaction-detail view at the top of the current interface; details are not appended below the report.
- The detail view retains the selected entity/period/property/project/loan/account scope, displays only retained POSTED local lines or a scoped empty state, and provides `Back to [report]` to restore the report view. JE and local Reconcile drills now also retain an explicit back-to-report context rather than silently resetting global filters.
- Cross-scope/missing-source evidence remains unavailable or review-only; no global fallback rows, automatic adjustment, posting, matching, clearing, payment, or reconciliation action is introduced. QBO runtime drill mechanics, scrolling, permissions/audit, responsive behavior, and functional equivalence remain unverified.
- `node verify-gl-drill-state.mjs`, `node verify-report-return-context.mjs`, `node verify-aging-gl-tb-bridge-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Revenue Recognition real-estate evidence shell (2026-08-03)

- A fresh read-only QBO Revenue Recognition audit showed the Accounting navigation route, `See report`, `Manage settings`, `New schedule`, and onboarding claims for automatic schedules, large-scale automatic journal entries, ASC 606 schedules/rules/period controls, and filters/reports. No schedule, setting, report, journal, feedback, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS now has an Accounting → Revenue Recognition local read-only workspace. It identifies retained local revenue lines through the selected entity/cutoff, marks eligible POSTED revenue evidence only when source/contract and property/project evidence are retained, and opens evidence in a separate detail view with Back navigation.
- Security deposits are explicitly shown as excluded liabilities. Unposted revenue, missing source/contract, missing property/project, related-party approval gaps, cross-entity activity, prepayments/deposits, delivery/lease-period policy, and reversal evidence remain review boundaries; no schedule, recognition decision, policy conclusion, or JE is created/changed.
- QBO automation, ASC/IFRS compliance claims, schedule management, settings, sales/products/subscriptions/orders, payment links/channels, CRM/contract/payment connections, exports, permissions/audit, responsive behavior, and functional equivalence remain unverified or excluded.
- `node verify-revenue-recognition-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## REFS interaction correction - Singleton navigation group (2026-08-03)

- Following the user requirement, any navigation parent with exactly one child is now a direct route and does not render an expandable duplicate child. For example, `Journal Entry` directly opens `Journal Entries`; no child submenu is shown.
- Multi-child groups preserve their existing expand/collapse behavior. This is a REFS shell interaction correction; QBO navigation permissions, responsive behavior, and functional equivalence remain unverified.
- `node verify-navigation-group-behavior.mjs` and `node build.mjs` pass (exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Prepaid expenses real-estate evidence shell (2026-08-03)

- A fresh read-only QBO Prepaid expenses audit showed the Accounting navigation route, `Prepaid expenses` heading, a loading state, `Give feedback`, and the empty/onboarding message `Let's automate your prepaid expenses amortization` / `Schedule your prepaid expenses from transactions and the schedules will show up here`. No schedule, transaction, posting, setting, feedback, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS now has an Accounting → Prepaid expenses local read-only workspace. It lists retained prepaid-account evidence by local entity/cutoff, amount, property/project, source/coverage state, and opens a separate detail view with Back navigation and retained JE/source drills.
- Only explicit locally retained coverage/schedule evidence can show `SCHEDULED_LOCAL_EVIDENCE`; only an explicitly retained amortization JE can show recognized-amortization evidence. Missing source/payment, dimensions, related-party approval, coverage dates, unposted records, cross-entity/dimension conflict, partial payment, void/reversal and unamortized balance remain review boundaries. No coverage, payment, schedule, or expense posting is inferred.
- QBO automated amortization/schedule posting, bill/vendor connection, OCR/attachment, Bill Pay, tax, Spreadsheet Sync, external connections, permissions/audit, responsive behavior, and functional equivalence remain unverified or excluded.
- `node verify-prepaid-expense-evidence.mjs`, `node verify-revenue-recognition-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Fixed assets real-estate evidence shell (2026-08-03)

- A fresh read-only QBO Accounting audit showed `Fixed assets` as an Accounting destination. Its empty/onboarding state showed `How it works`, `See reports`, `Add an asset`, `Add multiple assets`, and the message `Let’s automate your fixed asset depreciation` / `Add your first fixed asset, and we’ll take it from there.` The global shell also showed Accounting navigation entries for Bank transactions, Integration transactions, Receipts, Reconcile, Rules, Chart of accounts, Recurring transactions, Revenue recognition, Fixed assets and Prepaid expenses. No asset, draft, bulk asset, report, bookmark, feedback, setup, or depreciation action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS places Fixed assets under Accounting and presents QBO-observed `How it works` and `See reports` actions over the existing entity/cutoff-scoped local asset/CWIP evidence register. `See reports` preserves the selected cutoff when opening the local Balance Sheet; the local guide explains the retained source/POSTED-evidence workflow.
- The real-estate register retains only land, land improvements, buildings, CWIP and capitalized-interest evidence with retained entity/property/project/loan dimensions and direct GL source-JE drill. Land and CWIP remain non-depreciated; in-service balances remain review-only until explicit placed-in-service and POSTED depreciation evidence exists. Asset creation, bulk creation, automatic depreciation, disposal posting, tax books, valuation/inventory, scanning/attachments, exports and integrations are visibly excluded, not represented as equivalent.
- QBO asset forms, draft lifecycle, batch import behavior, filters, reports, permissions/audit, responsive behavior, disposal/reversal workflow, and functional equivalence remain unverified or incomplete. This shell does not create, edit, post, depreciate, transfer, dispose, or alter any business record.
- `node verify-asset-subledger-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Recurring transactions real-estate evidence shell (2026-08-03)

- A fresh read-only QBO Recurring Transactions audit showed `Reminder List`, `New`, `All Lists`, a `Filter by Name` textbox, an `All` status menu, a `Manage recurring payments` link, pagination, and a template table with `TEMPLATE NAME`, type, txn type, interval, previous date, next date, customer/vendor, amount and action columns. The settled empty state was `There are no recurring transactions matching the criteria.` No template, reminder, filter, payment, pagination, feedback, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS adds Accounting → Recurring transactions as a read-only local-plan evidence shell. It retains QBO-observed table/filter/empty-state structure and opens a separate plan-evidence screen with Back navigation, retained JE and source-document drills.
- Only explicitly retained recurring-plan metadata on an existing POSTED local JE may appear: template name, transaction type, interval, prior/next dates, amount, source reference, approver, party and property/project. The projection distinguishes approved, due-for-review, executed-evidence-retained, paused, expired and review-required states; execution cannot be inferred without a matching retained POSTED JE.
- QBO New/template editing, automatic bill/invoice/JE creation, reminder sending, recurring payments, payment methods, sales subscriptions, external contract/bank/CRM connections, Spreadsheet Sync, exports, plan audit/version lifecycle, permissions, responsive behavior and functional equivalence remain unverified or excluded. Lease cadence/free-rent/handover, completion, related-party, cross-entity and amount/dimension changes remain review boundaries.
- `node verify-recurring-transaction-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Receipts real-estate evidence shell (2026-08-03)

- A fresh read-only QBO Receipts audit showed `For review` and `Reviewed` tabs, Filter, Export, Customize/Settings, pagination, `Upload receipts`, and a table with bulk checkbox, Receipt, Created by, Date, Vendor, Payment account, Amount/Tax, Category and Action columns. Date, Vendor and Amount/Tax were observed sortable; the empty state said `Add new receipts to get started` and explained that QBO pulls out information for review and book entry. QBO also exposed email forwarding/autofill and bill/expense creation. No upload, email copy, filter, sort, customization, export, tab mutation, review, bill/expense creation, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS now has Accounting → Receipts as a separate read-only evidence screen rather than only a bank-workbench subsection. It preserves the observed review tabs, table shape, filter and empty-state interaction locally, then opens a dedicated receipt detail screen with Back navigation and retained JE/source/bank drills.
- Receipt rows derive only from retained POSTED local PM/AR/property-receipt JEs and explicit bank-match evidence within the active entity/cutoff. They retain entity, property/project, source reference, supporting-evidence presence, party, payment account, category and distinct evidence state. Bank evidence does not imply approval, payment, clearing or reconciliation; missing/cross-scope source evidence remains review-only.
- QBO upload/OCR/autofill, forwarding email, external attachment storage, automatic Bill/Expense creation, bank matching/posting, payment channels, Spreadsheet Sync, export, custom columns, sorting runtime, audit/permissions, responsive behavior and functional equivalence remain unverified or excluded. Rent, deposit, escrow/restricted cash, vendor/CWIP and related-party receipts remain separate business classifications.
- `node verify-receipt-bank-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Expenses unified local-evidence list (2026-08-03)

- A fresh read-only QBO Expenses audit showed `Expenses`, Purchase notifications, Print Checks, New transaction, a Transaction Type combobox, Filter, `Dates: Last 12 months`, disabled Export to Excel/Print controls, settings, and the empty state `No expenses found` / `Try to change some filters to see more results.` The opened type menu contained All transactions, Expense, Bill, Bill payment, Check, Purchase order, Recently paid, Vendor credit, Item Receipt, and Expense (Receipt reminder). No transaction, notification, check, filter application, print, export, settings, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, the REFS Expenses landing list now unifies local Bills, retained bill-payment evidence and retained Vendor Credit evidence in a single transaction projection. It keeps property/project, category, amount, remaining balance, local proof and review state visible; Bills open their existing retained trace and credits open only the retained JE.
- The visible total now reflects local evidence rows. QBO-observed Print and Export to Excel are disabled in the REFS evidence view, so it cannot send or export business data. CWIP/capitalized, prepaid, tax/insurance/HOA, related-party, escrow and loan-related expenses remain explicitly classified/review-bound rather than being silently merged into ordinary expense treatment.
- QBO Expense/Check/Purchase Order/Item Receipt/receipt-reminder creation, Bill Pay/ACH/card/check networks, vendor portals, OCR/attachment capture, notification enrollment, online printing, full filter/settings/sort/pagination behavior, permissions/audit, responsive behavior and functional equivalence remain unverified or excluded. Existing local Bill creation/payment logic is not evidence of QBO equivalence.
- `node verify-expense-transaction-listing.mjs`, `node verify-expense-listing.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Vendors evidence drill (2026-08-03)

- A fresh read-only QBO Vendors audit showed Pay vendors, New vendor, unpaid/overdue/open-bill/paid KPIs, Search, Print, Export, Settings, vendor-connection request notification, pagination, and a table with select-all, Vendor, Company name, Phone, Email, 1099 Tracking, Open Balance and Action. Vendor, Company name and Open Balance sorting were visible; sampled rows offered `Create bill` and an expand menu. No vendor, payment, connection, email, notification, print/export/settings, page change, bill, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, selecting a local Vendor now opens a dedicated detail screen with Back navigation. The detail shows only local master/related-party context and same-scope retained Bill/payment evidence, entity-scoped AP balance, tax-review state and retained JE drill; the list adds QBO-observed Print/Export/Settings as disabled shell controls.
- Local vendor balances continue to aggregate only qualifying POSTED AP/payment evidence per entity. The detail blocks unsupported JE/source drills when no retained proof exists and explicitly prevents cross-entity aggregation, supplier email/portal connection, payment, tax filing and master-data synchronization.
- QBO vendor creation/editing, connection-request handling, Pay vendors/ACH/check behavior, contact email/phone actions, 1099 e-file, filters/custom columns/sort/pagination runtime, permissions/audit, responsive behavior and functional equivalence remain unverified or excluded. `Create local bill` remains an existing REFS action, not evidence of QBO-equivalent workflow.
- `node verify-vendor-listing.mjs`, `node verify-bill-payment-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Reports Center business-fit scope (2026-08-03)

- A fresh read-only QBO Reports audit showed the report-center search and `Create new report` controls, Smart Reporting / Performance Center promotion, Shortcuts, and Favorites containing Accounts receivable aging summary, Balance Sheet, and Profit and Loss. No report was created, searched, favorited, saved, customized, refreshed, emailed, printed, exported, or otherwise changed.
- Following the Refs assistant3-WBS business-fit review, REFS now restricts the Reports Center to local close/control reports and retained-evidence drills. The observed creation button and plus menu are visibly disabled, while only locally runnable report favorites are persisted and restored in browser state.
- Custom report creation/sharing/distribution, email/print/export delivery, smart reporting, KPI/dashboard planning, Spreadsheet Sync, multi-company reporting, external data sources, sales channels, marketplace/Amazon connectors, and payment collection remain excluded from this real-estate bookkeeping scope.
- Report search, standard-report navigation, favorite state, exact QBO save/customize/More Options semantics, permissions/audit, responsive behavior, report availability by subscription, and all destination-level functional equivalence remain unverified or partial. No bookkeeping record is created or changed by this shell.
- `node verify-report-business-scope.mjs`, `node verify-report-favorites.mjs`, `node verify-report-workflow-targets.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Invoice / customer-payment lifecycle (2026-08-03)

- A fresh read-only QBO Invoice route audit showed an AI invoice-creation prompt and a QuickBooks Payments promotion with `Create invoice` and `Compare rates`, including card, ACH, Apple Pay, PayPal and Venmo claims. No invoice, payment account, quote, payment link, customer, setting, rate comparison, or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS Invoice rows now expose three independent local facts: posted AR invoice source, recorded/posted receipt evidence, and exact matched bank CREDIT. Selected local evidence shows the same independent lifecycle values alongside retained JE, bank and reversal drills.
- A local `POSTED_PAID` Invoice does not assert that its receipt has an exact bank match; `RECORDED_POSTED` does not assert allocation, settlement, clearance or reconciliation; missing/cross-entity/mismatched evidence remains explicit review state. AR Aging continues to require qualifying OPEN / posted local evidence and retains its GL control bridge.
- QBO AI invoice creation, online payment setup/links, cards/ACH/wallets/PayPal/Venmo, customer portal/CRM, estimates/orders, sales channels/ecommerce, subscriptions/automatic billing, external syncing, payment processing, partial/split/combined allocation, deposit/escrow classification, permissions/audit, responsive behavior and functional equivalence remain unverified or excluded. No REFS record is changed by the lifecycle projection.
- `node verify-invoice-payment-lifecycle.mjs`, `node verify-invoice-receipt-evidence.mjs`, `node verify-customer-payment-evidence.mjs`, `node verify-ar-aging.mjs`, `node verify-aging-local-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Bank Transaction lifecycle boundary (2026-08-03)

- A fresh read-only QBO `apptransactions` audit displayed sales-channel connection promotions for Amazon Business Purchases, Shopify, PayPal, Squarespace, Square, Wix, Etsy, eBay, Amazon, WooCommerce and BigCommerce, with `Connect free integration` controls. A guessed bank-transaction route returned a QBO not-found page. No connection, import, match, categorization, posting, clearing, reconcile action, export or other business-data action was invoked.
- Following the Refs assistant3-WBS business-fit review, each REFS bank-transaction row now shows separate retained `MATCHED`/`PENDING_REVIEW`, `CLEARED`/`NOT_CLEARED`, and `SIGNED_OFF`/`NOT_SIGNED_OFF` facts. A sign-off requires a retained account/period/statement history entry containing that bank item; no status upgrades another.
- The local Bank Transactions shell now visibly disables account-feed refresh/link, connection repair/disconnect, print/export/column controls, and receipt-list export. Existing local JE/bank/reconcile drills remain available only for retained scoped evidence.
- Sales-channel/ecommerce integrations, bank feeds/downloads, external connection/synchronization, payment gateways/portals/refunds, automatic match/categorize/clear/post, and QBO connection error handling remain excluded or unverified. Restricted/escrow/deposit/loan and cross-entity/related-party cash must remain separate review scope; QBO equivalence is not claimed.
- `node verify-bank-transaction-lifecycle.mjs`, `node verify-reconciliation-local-evidence.mjs`, `node verify-reconciliation-gl-tb-bridge-evidence.mjs`, `node verify-customer-payment-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Reconcile sign-off history detail (2026-08-03)

- A fresh read-only QBO Reconcile audit showed `Match the books to the bank records`, `Connect now`, `Video tutorials (7:48)`, `Get started`, and the stated benefits of keeping on track, finding accounting holes and preparing for tax time. No account was connected, setup started, tutorial opened, transaction matched/cleared, adjustment created, statement imported, reconciliation signed off, reopened, printed or exported.
- Following the Refs assistant3-WBS business-fit review, REFS reconciliation history rows now open a replacement detail view rather than appending data below the worksheet. The view exposes an immutable signed snapshot, statement scope, bank-item count, retained items, Match/Cleared status and JE/Bank/GL/AR/AP drills, with Back to reconciliation history.
- A Bank drill launched from this snapshot carries a return context to the same reconciliation history. A reopen request may change only reconciliation workflow metadata; the signed snapshot, bank item, JE, GL/TB and aging evidence are not overwritten or silently cancelled.
- QBO connection/setup, statement entry/import, clearing UI, reconciliation transaction selection, adjustment/finish/reopen semantics, history reports, permissions/audit, empty/responsive behavior and functional equivalence remain unverified. Automatic matching/clearing/posting/payment/refund and restricted/escrow/loan/cross-entity treatment remain excluded or manual review only.
- `node verify-reconciliation-history-detail.mjs`, `node verify-reconciliation-local-evidence.mjs`, `node verify-reconciliation-gl-tb-bridge-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Chart of Accounts to local register drill (2026-08-03)

- A fresh read-only QBO Chart of Accounts audit showed `Run report`, `New account`, batch actions/edit, name-or-number search, account-limit filter, export/print/settings, pagination (1–200), and table columns Select, Name, Account type, QuickBooks balance, Bank balance and Action. Observed bank and some A/R rows exposed `View register`; other account rows exposed `Run report`. No account, batch action, filter application, report, register, export, print, setting or data change was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS Account Register now accepts only local balance-sheet accounts (asset/liability/equity) and uses same-entity, selected-account, through-period POSTED evidence for its deterministic running balance. P&L accounts remain GL Detail reports rather than a register surrogate.
- Selecting a register line replaces the listing with a direct retained-entry detail and Back action. The detail retains account/entity/period, source, dimensions, debit/credit/running balance and local bank-evidence state, then gates source and reconcile drills by retained local scope. Non-cash accounts cannot open a cash reconciliation scope.
- QBO account create/edit, batch actions, native sorting/filter/pagination runtime, account/register direct edit/delete, bank/statement import, attachments, auto-match/post, export/sync, permissions/audit, responsive behavior and functional equivalence remain unverified or excluded. Deposits, escrow/restricted cash, loan, related-party and cross-entity entries remain separately scoped/reviewed rather than pooled.
- `node verify-account-register-evidence.mjs`, `node verify-chart-account-actions.mjs`, `node verify-gl-source-target.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## REFS update - Single-destination navigation groups (2026-08-03)

- User-provided REFS UI evidence showed a one-child `Journal Entry` parent rendered with a redundant `Journal Entries` sub-item. This is REFS product evidence, not a QuickBooks behavior claim.
- Following the Refs assistant3-WBS business-fit review, a group with exactly one effective local destination now routes directly from the parent and renders no expandable child. Legacy duplicate labels that point to the same route are treated as one destination; active direct parents expose the current page semantically.
- Multi-object working groups remain expandable: Expenses, Accounting, Reports, source/review/exception queues, and real-estate property/project, restricted-cash, related-party, CWIP and fixed-asset scopes retain explicit entries. Sales, external integrations, payment channels, spreadsheet sync and WBS automation are not added as shortcuts.
- QBO navigation hierarchy, role/subscription visibility, responsive/mobile behavior and functional equivalence remain unverified. This change only removes redundant local navigation, and it does not alter any bookkeeping data or route permission.
- `node verify-navigation-group-behavior.mjs`, `node build.mjs`, and scoped `git diff --check -- src/app.jsx` pass (exit 0; module-type warning is non-blocking). The whole-worktree whitespace check is currently blocked by pre-existing `index.html:1072` trailing whitespace outside this navigation scope; it has not been silently fixed here.

## QuickBooks read-only evidence & REFS update - Journal Entry source and audit detail (2026-08-03)

- A fresh read-only QBO Journal Entry audit showed an entry form with journal date/number, line Account/Debit/Credit/Description/Name/Class fields, eight blank lines, totals, Add lines, Clear all lines, Memo, attachment controls, Save / Save and new, Make recurring, Export to Excel, Paste line items and per-line duplicate/delete controls. No field was entered and no attachment, line, export, save, recurring action or deletion was invoked.
- Following the Refs assistant3-WBS business-fit review, REFS JE detail now makes retained source navigation explicit and carries a return context back to the exact JE for source-document drills. Audit history is an in-view toggle (not a toast), and exposes retained local event metadata plus a visible unverified boundary.
- The local JE evidence keeps posted/balance/source/dimension status independent. CWIP, restricted-cash, property/project/loan, related-party and cross-entity evidence remains review-scoped rather than inferred. A missing retained source cannot open a destination.
- QBO-observed external attachment, print/export, duplicate/copy and recurring automation affordances are not adopted for this property-accounting evidence workflow; print/export is disabled, attachment upload is removed, and copy is disabled. Draft, review, approval, post and reversal behavior remains pre-existing local workflow behavior and is not claimed QBO-equivalent.
- QBO form validation, native save/close/recurring/duplicate/delete semantics, external attachment storage, history data provenance, permissions/audit, responsiveness and functional equivalence remain unverified. Whole-worktree whitespace check is still blocked by pre-existing `index.html:1072`; scoped verification is reported separately.

## QuickBooks read-only evidence & REFS update - General Ledger report drill (2026-08-03)

- A fresh read-only QBO Reports audit found the report-catalog `General Ledger` result, then opened it without changing data. The rendered report showed Back to standard reports, period and From/To controls, Cash/Accrual basis, Customize, Save As, Compact, Refresh, Email/Print/Export/More actions and a table grouped by distribution account. Its observed columns were Distribution account, Transaction date, Transaction type, Num, Name, Description, Split, Amount and Balance; each account exposed Beginning Balance and Total rows.
- Following the Refs assistant3-WBS business-fit review, REFS GL Detail now calculates a per-account running balance from the same entity/dimension-scoped POSTED opening lines and in-period posted lines, ordered by account/date/JE/line. It retains source, counterparty/memo and property/project/loan evidence; non-POSTED and out-of-scope evidence is excluded.
- GL source drills now retain the report context, and AP, AR, bank and Source Documents destinations expose Back to the exact GL report scope. Report/TB/BS drill surfaces replace the current report with transaction detail and return via Back; no detail is appended under the summary.
- QBO delivery/export/print controls are represented as disabled local boundaries in GL and its detail views; source drill is enabled only for a retained local target. Local report-scope persistence and refresh/customize presentation remain local-only and do not create, save, email or export a QBO report.
- QBO native Customize/Save As/More behavior, report sorting/filtering/pagination, exact transaction type/split semantics, notes, audit/permission/responsive behavior and functional equivalence remain unverified. `node verify-gl-drill-state.mjs`, `node verify-gl-dimension-scope.mjs`, `node verify-gl-source-target.mjs`, `node build.mjs`, and scoped diff check pass (exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Trial Balance as-of scope (2026-08-03)

- A fresh read-only QBO Reports audit searched the standard-report catalog for `Trial Balance` (also listing Adjusted Trial Balance) and opened Trial Balance without changing data. It showed Back to standard reports, report period/From/To, Cash/Accrual, Display columns by, Customize, Save As, Compact, Refresh, Email/Print/Export/More actions, an `As of August 3, 2026` heading, Account plus Debit/Credit table segments, and equal Debit/Credit total values.
- Following the Refs assistant3-WBS business-fit review, REFS Trial Balance is now explicit `As of` the selected cutoff and aggregates only cumulative same-entity, same-dimension POSTED evidence through that cutoff. Its account amount drill now opens the same cutoff GL detail rather than an interval-only transaction view.
- The TB keeps property/project/loan scope and existing GL/TB, AR/AP control, cash/BS and dimension review evidence visible. Accounts with no qualifying local POSTED activity remain absent rather than appearing as global or fabricated zero-balance rows; restricted/escrow/trust, loan, CWIP/prepaid and related-party evidence remains separately scoped.
- QBO customize/save-as/adjusted-trial-balance, delivery/print/export, notes, column/sort/filter/pagination semantics, permissions/audit/responsiveness and functional equivalence remain unverified or excluded. No adjustment, posting, external connection, email or export is performed.
- `node verify-balance-sheet-asof.mjs`, `node verify-gl-drill-state.mjs`, `node verify-gl-dimension-scope.mjs`, `node build.mjs`, and scoped diff check pass (exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Balance Sheet cash grouping (2026-08-03)

- A fresh read-only QBO report-catalog audit found Balance Sheet, Balance Sheet Comparison, Detail and Summary. The opened Balance Sheet displayed report period/From/To, Cash/Accrual, Display columns by, Compare to, Customize, Save As, Compact, Refresh, Email/Print/Export/More actions/Insights, `As of August 3, 2026`, and nested Assets → Current Assets → Bank Accounts → account rows → total. No control or report data was changed.
- Following the Refs assistant3-WBS business-fit review, the REFS Balance Sheet now renders its asset body with separate drillable Operating, Escrow, Restricted, Security deposit and Payroll-restricted cash sections before development/CWIP, land/building, prepaids and other assets. The group totals and individual accounts preserve the existing same-scope as-of GL drill and return path.
- BS remains calculated only from cumulative same-entity, same-dimension POSTED evidence through the selected cutoff. Assets = liabilities + equity remains visible, while cash groups continue to reconcile to same-scope bank/register and Cash Flow evidence rather than being assumed operational cash.
- QBO compare/customize/save-as/detail/summary/insights, bank-account master semantics, external delivery/print/export, notes, permissions/audit/responsive behavior and functional equivalence remain unverified or excluded. No connector, adjustment, posting or export is performed.
- `node verify-cash-account-scope.mjs`, `node verify-balance-sheet-asof.mjs`, `node verify-gl-drill-state.mjs`, `node build.mjs`, and scoped diff check pass (exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Income Statement real-estate presentation (2026-08-03)

- A fresh read-only QBO standard-report audit searched and opened `Profit and Loss`. The catalog exposed comparison, tag group, % of total income, class, customer, month, detail, YTD comparison and quarterly-summary variants. The opened report showed year-to-date From/To, Cash/Accrual, display columns/compare/customize/save/compact/refresh/delivery controls and the empty state `Your selection doesn’t have any info. Change your selection or start a new search.` No report setting or business data was changed.
- Following the Refs assistant3-WBS business-fit review, REFS Income Statement now separates Rental income, Other property income, review-only other income, Property operations, Interest and financing, Capital/completion review and General & Administrative; every amount retains its existing same-scope GL drill and Back path.
- The P&L uses only same-entity, property/project/loan-scoped POSTED accrual evidence. It now has an explicit zero-activity empty state. CWIP, land/building acquisitions, prepaids, escrow/deposit and deferred/related-party balances are marked balance-sheet evidence rather than silently folded into operating P&L; capitalized vs expensed interest remains source/completion review.
- QBO cash-basis recomputation, comparison/class/customer/tag/month/detail report variants, sales/collection channels, budget/KPI/forecasting, external connectors/Spreadsheet Sync, delivery/print/export, automatic adjustment/posting, permissions/audit/responsive behavior and functional equivalence remain unverified or excluded.
- `node verify-income-statement-classification.mjs`, `node verify-gl-dimension-scope.mjs`, `node verify-gl-drill-state.mjs`, `node build.mjs`, and scoped diff check pass (exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Cash Flow scope reconciliation (2026-08-03)

- A fresh read-only QBO Standard Reports audit searched and opened `Statement of Cash Flows`. The report showed Back to standard reports, year-to-date From/To, Cash/Accrual basis, Display columns by, Customize, Save As, Compact, Refresh, Email/Print/Export/More/Insights controls, and Account Name / Total columns. Its observed body included Operating Activities, Net Income, adjustments reconciling net income to net cash provided by operations, Net cash provided by operating activities, Net cash increase for period, Cash at beginning of period and Cash at end of period. No QBO report setting, export, email, print, transaction, account or other business data was changed.
- Following the Refs assistant3-WBS business-fit review, REFS now retains operating cash as the sole O/I/F cash-flow stream, while Escrow, Restricted, Security-deposit and Payroll-restricted cash stay separate scope balances. It shows each retained scope's opening / movement / closing and reconciles total retained cash independently to the same-scope Balance Sheet cash total.
- Every retained cash-scope summary with local account evidence is drillable. Selecting it replaces the Cash Flow report with cumulative transaction detail and explicit Back to Cash Flow; it never appends a detail table beneath the report. Operating/investing/financing category rows retain their period-only local JE drill.
- Property rent/management receipts and property operations remain Operating; acquisition/disposal/CAPEX/CWIP remain Investing; capital/loan draw/repayment and qualifying interest remain Financing; internal transfers, deposits/prepayments and entries without retained classification remain excluded or review-required. Bank feeds, automatic categorization/matching, forecasting, external connectors, sales channels, WBS/kernel/AI and QBO functional equivalence are not claimed.
- `node verify-cash-flow-evidence.mjs`, `node verify-cash-account-scope.mjs`, `node verify-gl-drill-state.mjs`, `node verify-balance-sheet-asof.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Reports Center local entry boundary (2026-08-03)

- A fresh read-only QBO Standard Reports audit showed a report-catalog combobox, `Create new report`, a Smart reporting tip, a Performance center dashboard shortcut, and favorite report links for Accounts receivable aging summary, Balance Sheet and Profit and Loss with star and More Options controls. No favorite, report, dashboard, setting, export, email, print, connection or business record was changed.
- Following the Refs assistant3-WBS business-fit review, REFS marks only locally supported close reports as routable: Trial Balance, GL Detail, Balance Sheet as-of, Income Statement/Profit and Loss, Cash Flow, AP Aging, AR Aging and Reconciliation History. Each catalog row now states `AVAILABLE_LOCAL_EVIDENCE`, `NO_LOCAL_EVIDENCE`, `REVIEW_REQUIRED` or `REFERENCE_ONLY`; reference-only rows cannot launch a local target or become favorites.
- Selecting a local preview report now replaces the Reports Center list with a standalone local-evidence detail view and explicit `Back to Reports Center`; it no longer renders a report below the catalog. The detail exposes local evidence scope, disables Save As/Print/Export, and does not assert QBO report creation or delivery.
- Entity/period/as-of/property/project/loan and retained-account scope remain owned by the destination workflow and are visible there. Restricted/escrow cash, CWIP/prepaids, related party, cross-entity and missing-dimension evidence remain review boundaries. Sales/revenue channels, KPI/dashboards, planning/forecasting, custom report creation/sharing/subscription, Spreadsheet Sync, external data sources/connectors, email/print/export and automatic adjustments/posting remain excluded or unverified.
- `node verify-report-business-scope.mjs`, `node verify-report-workflow-targets.mjs`, `node verify-report-favorites.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).

## QuickBooks read-only evidence & REFS update - Expenses transaction list and vendor-credit detail (2026-08-03)

- A fresh read-only QBO Expenses audit showed the Expenses heading, Print Checks, New transaction, Transaction Type, Filter, `Dates: Last 12 months`, disabled Export to Excel / Print controls, and the empty state `No expenses found` with guidance to change filters. The page also displayed an Expert Assisted promotion. No transaction, filter application, check setup, purchase-notification enrollment, creation, edit, payment, export, print or connection was invoked.
- Following the Refs assistant3-WBS business-fit review, the unified REFS Expenses queue retains Bill, Bill payment and Vendor credit evidence with date/type/number/payee/category/property-project/amount/balance/state/local-proof. It keeps existing local filter boundaries and the QBO-observed empty state; unsupported types remain unavailable.
- Selecting a Vendor credit now opens an independent local credit detail instead of jumping directly to an unexplained JE. It exposes credit/application/unapplied amounts, entity, property/project, linked bill, pre-credit payment evidence, POSTED audit state and independent bank/reconcile state; Back returns to Expenses. Only retained local evidence enables Bill, JE or local reconciliation drills.
- CWIP/capitalized and prepaid source gaps, tax/insurance/HOA, related-party, escrow/trust, loan-related cash, cross-entity/vendor/dimension mismatch, unapplied or excessive applications remain review-only and cannot silently reduce AP Aging. Bill Pay, online ACH/card/check, supplier portal, OCR/attachments, external links/sync, sales channels, automatic categorization/posting, email/export/share and QBO equivalence remain excluded or unverified.
- `node verify-vendor-credit-evidence.mjs`, `node verify-expense-transaction-listing.mjs`, `node verify-expense-listing.mjs`, `node verify-bill-payment-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; module-type warnings are non-blocking).
# Accounting — Payment → Bank Transaction → Reconcile return chain (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Reconcile entry | QBO `/app/reconcile` displayed “Match the books to the bank records”, connected-account guidance, `Connect now`, video tutorials and `Get started`. No account was connected and no reconciliation action was taken. | A payment’s retained, exact bank-debit evidence now replaces the payment list with a dedicated read-only bank-evidence view. It exposes statement date, direction/amount, cash scope, retained JE, cleared state and reconciliation state separately. | PARTIAL — the QBO connected-bank onboarding and all write controls remain deliberately excluded. |
| Payment → bank drill | The observed QBO reconcile landing confirms reconciliation is a distinct workflow. | The payment history’s retained exact bank debit opens a replacement bank-transaction view (not a panel appended below the payment list); **Back to Bill payments** preserves the payment-list context. No retained debit remains disabled. | PARTIAL — only locally retained evidence can drill. No import, auto-match, clearance, posting, payment, refund or statement alteration is available. |
| Bank → reconcile return | No QBO match/clear/sign-off was executed. | **Open local reconcile evidence** passes the precise bank account/transaction and creates a **Back to bank transaction** path, which then returns to Bill payments. Match, cleared and signed-off statuses are independent displayed facts. | PARTIAL — operational reconcile actions are out of scope until locally evidenced and separately authorized. |
# Reports — A/R Aging report-centre return (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| A/R Aging Summary entry | QBO Standard Reports showed `Accounts receivable aging summary` as a favorite. Its report page had `Back to standard reports`, an as-of report period selector/date field, Customize, Save As, Compact, refresh, Email/Print/Export/More actions, title and ready state. The selected date had no information, so QBO displayed an empty-result alert and an empty table. | Launching the local `Accounts receivable aging summary` or `AP Aging` workflow now preserves a report-centre return context. The AP/AR workspace renders **Back to reports** at the top, restoring the user to the report centre instead of appending a detail below the previous surface. | PARTIAL — REFS uses retained local POSTED invoice/bill, receipt/payment and credit evidence only; the as-of aging/control bridge is local proof, not a QBO-equivalence claim. |
| Aging scope | QBO observed an as-of selector and empty state; no customer, payment, customize, save, email, print or export action was executed. | Assistant3 business-fit review is applied: entity, report date, counterparty, property/project, source completeness and control-account differences remain explicit. AP/AR Aging excludes sales channels, payment links, external sync, auto-adjustment and WBS automation. | PARTIAL — QBO customization/saving/delivery/permissions and populated table columns are not verified; external/output actions remain unavailable. |
# Reports — General Ledger entry and drill evidence (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| General Ledger report | QBO Standard Reports search returned `General Ledger` and `General Ledger List`. The selected General Ledger report had Back to standard reports; period, From/To and Cash/Accrual controls; Customize, Save As, Compact, Refresh, Email, Print, Export and More actions; a ready status; and grouped account rows. | `General Ledger` is now a routable local-ledger report in the REFS report centre, opening GL Detail rather than a reference-only placeholder. The existing detail is limited to retained POSTED JE, shows journal/date/entity/source/account/property-project-loan/memo/debit/credit/running balance, and drills into JE/source with scoped Back. | PARTIAL — only the business-fit subset is implemented; no QBO save/customize/delivery/output workflow, General Ledger List, or external source sync. |
| Grouped account/balance presentation | QBO table headers observed: Distribution account, transaction date/type, number, name, description, split, amount and balance; visible accounts were grouped with beginning balance and total rows. No row drill or modification was executed. | REFS retains beginning/running balance only from its same-scope POSTED journal set, plus explicit entity and real-estate dimensions. Unknown/cross-entity/missing-dimension source routes remain review-only rather than being silently included. | PARTIAL — QBO populated-row drill, transaction-type/name/split field semantics, sorting and permissions are not fully verified. |
# Reports — Trial Balance evidence boundary (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Trial Balance | QBO Standard Reports search returned `Trial Balance` and `Adjusted Trial Balance`. Trial Balance showed Back to standard reports, period/From/To, Cash/Accrual, Display columns by, Customize/Save As/Compact/Refresh/Email/Print/Export/More actions, an as-of heading and ready state. Its account table exposed Account, Debit, Credit and a TOTAL row with equal totals. | REFS Trial Balance remains a local-ledger report: same-entity/same-dimension cumulative POSTED evidence only; account, debit, credit and balance are shown with account drill to a replacement transaction-detail view and Back. Local report controls surface TB debit=credit, GL=TB and the aging/control bridges. | PARTIAL — QBO display-column customization, save/delivery/output, populated-row permissions and exact date behavior are not fully reproduced or claimed. |
| Adjusted Trial Balance | QBO search exposed the entry, but it was not opened and no adjusting workflow was performed. | `Adjusted Trial Balance` is now listed in REFS as **Reference only — unavailable**, not made drillable. It cannot create or infer adjusting entries. | NOT EQUIVALENT — adjustment columns, adjustment policy/audit and any posting behavior lack retained local evidence and are intentionally excluded. |
# Reports — Balance Sheet hierarchy and control boundary (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Balance Sheet | QBO Balance Sheet had Back to standard reports; year-to-date/From/To; Cash/Accrual; Display columns by; Compare to; Customize/Save As/Compact/Refresh/Email/Print/Export/More actions; Insights; as-of heading and ready status. Its visible hierarchy was Assets → Current Assets → Bank Accounts → bank rows → Total for Bank Accounts. | REFS Balance Sheet is an as-of, same-entity, same-dimension POSTED view with replacement account-detail drill and Back. It separates operating, escrow, restricted, security-deposit and payroll-restricted cash before showing non-cash assets; cash group/BS and operating cash/Cash Flow control ties are explicit. | PARTIAL — business-fit cash grouping is intentional; QBO comparison/insights/customization/delivery and exact account classification are not verified or implemented. |
| Display columns | QBO showed a `Display columns by` control; no option was changed. | REFS now exposes only disabled `Total`: prior inert Months/Entities options were removed. The tooltip states that comparison columns are not established for retained local evidence. | HONESTLY LIMITED — no unimplemented comparison option is represented as functional. |
# Reports — Profit and Loss / Income Statement evidence boundary (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Profit and Loss | QBO Standard Reports search returned Profit and Loss plus comparison, tag/class/customer/month/detail/YTD/quarter variants. The base report exposed Back, period/From/To, Cash/Accrual, Display columns by, Compare to, Customize/Save As/Compact/Refresh/Email/Print/Export/More actions/Insights, ready status and an empty-result alert/table for the selected period. | REFS `Profit and Loss` remains an alias to the local Income Statement: same-entity, same-dimension POSTED accrual evidence, account-level replacement drill, JE/source route and Back. It presents rental income, other property income, property operations, interest/financing, capital-completion review and G&A separately; balance-sheet-only CWIP/land/prepaid/escrow/deposit/related-party evidence is not silently treated as operating P&L. | PARTIAL — QBO’s populated P&L rows, variant reports, comparisons and data-row drill are not observed; no claim of column-level equivalence. |
| Compare / Insights | QBO base P&L showed Compare to and Insights, but neither was opened. | REFS now renders both controls only on Balance Sheet and Income Statement as disabled evidence controls with precise scope titles. | HONESTLY LIMITED — comparison periods and automated narrative insights are not established from retained local evidence. |
# Reports — Statement of Cash Flows control fit (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Statement of Cash Flows | QBO report had Back, period/From/To, Display columns by, Customize/Save As/Compact/Refresh/Email/Print/Export/More actions and Insights. The ready table exposed Account Name/Total, Operating Activities, Net Income, reconciliation adjustments, Net cash provided by operating activities, net cash increase, beginning cash and ending cash. No Cash/Accrual control was present. | REFS Cash Flow now omits the generic Cash/Accrual control; it retains period and replacement-drill behavior, operating/investing/financing totals, opening/closing cash and Balance Sheet reconciliation. Operating, escrow, restricted, security-deposit and payroll-restricted cash remain separately reconciled and drill only through retained POSTED evidence. | PARTIAL — QBO adjustment row taxonomy, table sorting/display variants, insights and output/customization behavior are not reproduced or claimed. |
| Insights | QBO showed an Insights button; it was not opened. | REFS renders disabled Insights for Cash Flow with an explicit local-scope limitation. | HONESTLY LIMITED — no automated narrative/forecast is produced. |
# Accounting — Reconcile history route integrity (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Reconcile landing / history drill | QBO `/app/reconcile` was observed read-only on its connected-account landing: `Connect now`, video tutorials and `Get started`; no account, history row, match, clearance, sign-off, edit, export or connection was invoked. Therefore QBO history-row behavior remains unobserved. | A retained local reconciliation history ID passed in navigation context now opens its immutable sign-off detail as a **full-page replacement**, not below the worksheet. **Back to reconciliation history** restores the worksheet; an unknown/empty ID opens no detail and cannot manufacture a snapshot. The retained detail can route to its linked bank evidence, which preserves a return context. | PARTIAL — local route integrity is verified; QBO history list, row permissions, lifecycle UI and populated-account behavior are not verified or claimed. |

- `node verify-reconciliation-history-route.mjs`, `node verify-reconciliation-history-detail.mjs`, `node verify-reconciliation-local-evidence.mjs`, `node verify-reconciliation-reopen-evidence.mjs`, `node verify-bank-reconciliation.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

# Reports — local report-center scope and empty-state contract (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Reports Center entry | Previously observed QBO report entry points establish navigation shells and certain report controls, but no report filter/change/save/output action was taken in this cycle. | Reports Center now declares its active local entity, 2026-01–2026-07 period, accrual basis, retained POSTED journal count, separated cash scopes and missing-dimension review count before a report is opened. | PARTIAL — the scope contract is local; QBO scope/filter persistence and display behavior are not claimed. |
| Report-center empty state | No QBO data was changed or exported. | The catalog distinguishes `NO_LOCAL_EVIDENCE_IN_SCOPE`, `NO_POSTED_LOCAL_ACTIVITY`, `REVIEW_REQUIRED_MISSING_DIMENSION`, and available local POSTED evidence. It does not present a global/zero result as entity-scoped evidence. | PARTIAL — exact QBO empty messages, permissions, custom/management/report output behavior remain unverified and unavailable. |

- Assistant3 business-fit review applied before implementation. `node verify-report-scope-empty-state.mjs`, `node verify-report-business-scope.mjs`, `node verify-report-workflow-return.mjs`, `node verify-report-workflow-targets.mjs`, `node verify-report-return-context.mjs`, `node verify-report-control-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

# Accounting — Bank Transaction local entry and empty-state boundary (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Bank account entry | QBO Reconcile connected-account onboarding was observed read-only; no bank was connected, refreshed, repaired, disconnected or reconciled. | Local bank account cards now say **Local evidence** (never `Connected`), show retained-through date and local balance difference. Their scope remains an explicit local bank account/period/cash scope, not a bank connection claim. | PARTIAL — QBO connection status, feed freshness and account-card interactions are unverified and excluded. |
| Bank Transaction empty states | No QBO bank data/filter state was changed. | Empty queues now distinguish `No local bank evidence`, `No POSTED cash activity in this scope`, `No eligible items for this statement period`, and `Scope conflict / missing dimension`; they state account/period/cash scope/entity and allow only local register or evidence-gated GL drill. | PARTIAL — behavior is local, unit-verified and does not reproduce QBO feed or statement-empty semantics. |

- Assistant3 business-fit review applied before implementation. `node verify-bank-scope-empty-state.mjs`, `node verify-bank-transaction-evidence.mjs`, `node verify-bank-transaction-lifecycle.mjs`, `node verify-bank-transaction-return.mjs`, `node verify-bank-reconciliation.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

# Expenses — detail-return scope retention (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| List / detail / Back context | QBO Expenses was observed read-only with Transaction Type, Filter, Date range and empty state, but no row/detail/back interaction was available to exercise. Exact QBO return semantics remain unobserved. | Before a local Bill, Vendor Credit or review exception replaces the Expenses surface, REFS freezes the active tab, search, status, transaction type, date range/from/to, vendor, category and bill-queue scope. **Back to Expenses** explicitly restores that scope; opening a Bill from AP Aging returns to AP Aging rather than silently switching to Bills. | PARTIAL — local return behavior is unit-verified; QBO populated-row, pagination and browser-history behavior are unverified. |

- `node verify-expense-detail-return.mjs`, `node verify-expense-review-exceptions.mjs`, `node verify-expense-transaction-listing.mjs`, `node verify-expense-listing.mjs`, `node verify-vendor-credit-evidence.mjs`, `node verify-ap-aging.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

# Expenses — local review-exception queue (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Expense review exceptions | QBO Expenses was previously observed read-only in its empty list state; no exception, bill, credit, resolution or collaboration action was performed. QBO exception UI is unobserved. | REFS adds a local review-only queue for retained Bill and Vendor Credit evidence. It explicitly exposes source, reason/severity, entity/vendor, property/project, amount/open amount, evidence state and an independent `OPEN` / `HELD` workflow. Selecting a row replaces the list with a full-page review detail; **Back to Expenses** restores the in-memory list scope. | PARTIAL — this is a real-estate local control, not a claim of QBO exception equivalence. |
| Resolution boundary | No QBO state was changed. | Related party, asset/CWIP/prepaid, missing POSTED AP proof, missing property/project and unapplied/review credit exceptions remain blocked from automatic resolution. The detail shows retained owner/history, drills only to its Bill/Credit/JE and disables resolution. | HONESTLY LIMITED — no adjustment/posting, categorization, payment/refund, credit application/void, feed/OCR/attachment connection, notification, sales channel, external sync or Spreadsheet Sync is available. |

- Assistant3 business-fit review applied before implementation. `node verify-expense-review-exceptions.mjs`, `node verify-vendor-credit-evidence.mjs`, `node verify-expense-transaction-listing.mjs`, `node verify-expense-listing.mjs`, `node verify-ap-aging.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

# Accounting — Bank Transaction full-page drill and source return (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Bank transaction detail | QBO Reconcile was read-only at its connected-account entry; no bank row, match, category, clear, sign-off, statement, feed, export or connection action was opened. QBO populated Bank Transaction detail remains unobserved. | A retained Bank Transaction reached by context now replaces the list with a full-page evidence detail. It displays bank/book date, direction/amount, cash scope, entity, retained JE and separate match/cleared/sign-off facts. **Back** restores either the exact Reconcile history context (including history ID) or the Bank Transaction account, queue, search, date/type filters and page. | PARTIAL — local read-only evidence and return context are verified; QBO row layout/actions/permissions are not claimed. |
| Real-estate evidence boundary | No QBO transaction was changed. | The direct detail retains only entity/cash-account/direction/amount/POSTED/duplicate-gated JE proof. Operating, restricted/escrow/trust and loan cash scope remain explicit; related-party, missing-source, cross-entity and same-amount ambiguity remain review-only. | PARTIAL — no bank feed/download/OCR, auto-match/categorization/posting, online payment/refund, sales channel, external connection or synchronization is implemented. |

- Assistant3 business-fit review applied before implementation. `node verify-bank-transaction-return.mjs`, `node verify-bank-transaction-evidence.mjs`, `node verify-bank-transaction-lifecycle.mjs`, `node verify-bank-transaction-pagination.mjs`, `node verify-bank-reconciliation.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

# Accounting — Bank Transaction → GL/TB → Bank evidence return (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Bank evidence report drill | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A valid retained Bank Detail now opens GL Detail or Trial Balance with its exact bank-account/item context. The report replaces the page and visibly offers **Back to bank evidence**, returning to the same local Bank Detail rather than appending a report result below a list. | PARTIAL — local context and full-page return are verified; QBO populated bank/report drill behavior, permissions, audit and responsive state remain unobserved. |
| Local real-estate cash boundary | No fresh QBO evidence this cycle. | The drill remains limited to a same-entity, same-cash-account, direction/amount-consistent, duplicate-gated POSTED JE. Operating, restricted/escrow/trust, loan, related-party and dimensional conflicts remain Review; it cannot feed/import/OCR, auto-match/categorize/post/clear/sign, connect, pay/refund, synchronize or export. | PARTIAL — assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-bank-report-return.mjs`, `node verify-bank-transaction-return.mjs`, `node verify-bank-transaction-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

# Accounting — Signed Reconcile History → GL/TB → statement return (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Signed statement report drill | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Immutable signed-history detail now exposes both **Open GL Detail** and **Open Trial Balance**. Both retain account, period, statement cutoff, cash account/scope, selected bank item and signed history ID; the report’s existing visible Back returns to that same statement detail. | PARTIAL — local retained-scope behavior is verified; QBO populated Reconcile report drill, permissions, audit and responsive behavior remain unobserved. |
| Reconciliation control boundary | No fresh QBO evidence this cycle. | Only retained same-entity POSTED cash JE/bank evidence qualifies. Draft/review/balanced/signed/reopened are independent workflow states; escrow/restricted/trust/loan, deposits/prepayments, related-party/cross-entity/cross-period and missing dimensions remain Review. No feed/import/OCR, auto match/clear/adjust/post, payment/refund, external share/export or sync is offered. | PARTIAL — assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-reconciliation-report-return.mjs`, `node verify-reconciliation-history-detail.mjs`, `node verify-reconciliation-local-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

# Expenses — AP Aging Vendor Credit → retained credit detail return (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| AP Aging credit evidence drill | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | Opening **Credit evidence** from AP Aging replaces the page with the retained Vendor Credit detail. Its visible Back now says **Back to AP Aging** and restores the captured entity/as-of/vendor/bucket scope rather than implying a generic Expenses return. | PARTIAL — local AP-aging return is verified; QBO credit application/detail/back/filter/permission/audit behavior remains unobserved. |
| Vendor-credit control boundary | No fresh QBO evidence this cycle. | Only retained POSTED same-entity/same-vendor applied credit evidence may reduce a Bill and AP Aging; limits, source, prepaid/CWIP, escrow/loan, related-party and dimensional conflicts remain Review. No Bill Pay/refund, online payment, portal/OCR, automatic apply/post, external connection/sync or export is offered. | PARTIAL — assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-vendor-credit-evidence.mjs`, `node verify-ap-aging.mjs`, `node verify-aging-local-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

# Receivables — AR Aging → Invoice/control JE retained return (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| AR Aging evidence drill | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | An AR Aging row now opens Invoice Detail with its explicit Aging as-of scope; a local AR control-difference JE also retains that scope. Both details use visible **Back to AR Aging**, restoring the focused report rather than defaulting to Invoices or adding a lower detail panel. | PARTIAL — local return contract is verified; QBO A/R Aging drill/filter/permission/audit behavior remains unobserved. |
| AR availability boundary | No fresh QBO evidence this cycle. | Only same-scope retained POSTED invoice/receipt evidence supports AR; date-after-cutoff receipts/reversals, deposits/prepayments, escrow/restricted cash, related-party/cross-entity/dimensional conflicts and ambiguous same-amount candidates remain Review. No payment links/online collection/refund/portal/CRM, auto allocation/posting, feeds/OCR, sales channels, sync or export is offered. | PARTIAL — assistant3 business-fit control, not QBO equivalence. |

- Assistant3 business-fit review applied before implementation. `node verify-ar-aging-return.mjs`, `node verify-ar-aging.mjs`, `node verify-aging-local-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

# Reports — scoped drill customization boundary (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Balance Sheet / Cash Flow drill controls | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | The existing full-page report drill continues to return to its originating report. Its **Customize unavailable** control is now explicitly disabled instead of emitting a misleading customization-success notice. | PARTIAL — report customization, sharing, subscriptions, export, permissions, audit and responsive behavior are excluded or unobserved; no QBO equivalence is claimed. |

- Assistant3 business-fit review applied before implementation. `node verify-report-drill-boundaries.mjs`, `node verify-balance-sheet-register-return.mjs`, `node verify-cash-flow-register-return.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

# Expenses — Payment detail → GL/TB retained return (2026-08-04)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Payment evidence report drill | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the Reconcile page. | A Payment Detail with a retained POSTED payment JE now opens GL Detail or Trial Balance with its exact payment origin. The report’s visible Back restores Payment Detail, then its Bill/Payments origin; no report detail is appended below the payment view. | PARTIAL — local scope/return contract verified; QBO payment report drill, allocation, permissions and audit remain unobserved. |

- Assistant3’s prior Bill/Payment business-fit review remains applicable. `node verify-payment-detail-report-return.mjs`, `node verify-bill-payment-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` are required verification.

# Expenses — Vendor Credit full-page correction (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Vendor Credit detail | QBO Expenses was observed read-only in an empty state, so no credit row/detail was opened; QBO detail layout remains unobserved. | Vendor Credit now uses the same **full-page replacement** pattern as Bill detail (not a side drawer and not content appended under the list). It keeps the existing retained credit/application/unapplied/entity/property-project/bank-reconcile evidence and explicit **Back to Expenses** action, which restores the in-memory list state. | PARTIAL — full-page local interaction is verified by build; QBO credit edit/apply/refund/void, attachments, permissions and populated-detail behavior are unverified and unavailable. |

- `node verify-vendor-credit-evidence.mjs`, `node verify-expense-transaction-listing.mjs`, `node verify-expense-listing.mjs`, `node verify-bill-payment-evidence.mjs`, `node build.mjs`, and scoped `git diff --check` pass (all exit 0; existing module-type warnings are non-blocking).

# Expenses — list-to-detail replacement and return (2026-08-03)

| Surface | Fresh read-only QBO evidence | REFS implementation | Status / gap |
| --- | --- | --- | --- |
| Expenses list | QBO `/app/expenses` showed Expenses heading, Purchase notifications, Print Checks, New transaction, Expert Assisted offer, Transaction Type, Filter, Dates: Last 12 months, disabled Export/Print, settings and `No expenses found` / filter-change empty state. No transaction was created or changed. | REFS keeps local Bill/Payment/Vendor-credit rows with type/date/status/search gates and local configurable evidence columns. Assistant3’s business scope is applied: entity/vendor/property-project/category, paid/credit/bank proof and source completeness remain explicit; CWIP/prepaid/tax-insurance-HOA/escrow-loan/related-party stay review-bound. | PARTIAL — QBO payment/portal/OCR/attachment/feed/export actions remain excluded; QBO populated table columns and permissions were not observable in this company’s empty state. |
| Bill / credit detail | QBO list supplied no row to open. | Clicking a Bill or Vendor Credit now replaces the Expenses list with a full-page retained-evidence detail; top **Back to Expenses** restores the in-memory current tab and filters. Detail drills only to retained AP/payment/reversal JE, source document, Bank/Reconcile and related aging evidence. | PARTIAL — no QBO bill edit/payment/refund/void/attachment action is performed. POSTED, matched, cleared and signed-off are not inferred from each other. |
## Reports — Balance Sheet scope-control boundary (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Balance Sheet as-of → scoped GL Detail → Back | No fresh QBO page evidence this cycle: the read-only browser bridge returned no auditable tab. Earlier recorded QBO Balance Sheet shell remains the only source evidence. | The existing full-page Balance Sheet amount drill retains entity, cutoff, Property/Project/Loan scope and POSTED local evidence; its Back returns to the report instead of appending detail below it. | PARTIAL — retained-local drill/return verified in code; fresh QBO amount-click behavior is unavailable. |
| Business-fit report controls | No fresh QBO page evidence this cycle. | Customize, More, and automated Insights now say unavailable; only local scope/filter, as-of statement, GL/JEs and control ties remain. QBO report customization, sharing/notes, KPIs, delivery/export and external links are intentionally excluded. | PARTIAL — a deliberate business boundary, not QBO equivalence. |

## Reports — AP Aging row-detail retained scope (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| AP Aging row → Bill detail → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | On entering Bill detail from AP Aging, REFS retains the local vendor, aging bucket and as-of date. Returning remounts the same AP Aging scope rather than silently reverting to the default date or appending a detail panel beneath the report. | PARTIAL — local return logic/build verified; QBO row drill behavior remains unobserved this cycle. |
| AP Aging control/review boundary | No fresh QBO evidence this cycle. | Aging stays retained-POSTED local evidence only; control-account differences remain review rows and cannot auto-allocate, adjust, post, email, export or start an external payment workflow. | PARTIAL — business-fit boundary, not QBO equivalence. |

## Reports — AR Aging full-page invoice drill (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| AR Aging row → Invoice detail → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | An Aging row now replaces the workspace with a full-page Invoice detail, exposing only retained source JE, receipt JE, exact local bank credit and reversal evidence. Back returns to AR Aging with its report date, rather than showing a detail section below the invoice list. | PARTIAL — local full-page return is build-verified; fresh QBO row drill evidence is unavailable. |
| AR Aging control/review boundary | No fresh QBO evidence this cycle. | Only retained POSTED/open AR evidence reaches Aging. Deposit/restricted funds, partial allocations, missing/cross-entity dimensions and void/reversal cases remain explicit review states; no collection, payment link, portal, reminder, automatic allocation or adjustment is provided. | PARTIAL — deliberate business scope, not QBO equivalence. |

## Accounting/Reports — Reconcile report-return scope (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Reconcile → GL Detail / TB / AP Aging / AR Aging → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | The local Reconcile worksheet now passes its bank account, statement period/cutoff, cash scope, mapped cash account and retained return context into each report. Each target shows `Back to reconciliation` rather than abandoning the worksheet context. | PARTIAL — local navigation/build verified; QBO report handoff behavior remains unobserved. |
| Reconcile scope boundary | No fresh QBO evidence this cycle. | The worksheet remains read-only evidence: matched, cleared and signed-off are distinct; reports still use POSTED JEs only. Bank feeds/import/OCR/auto-match/adjustments/posting/payments/export/share/sales channels remain excluded. | PARTIAL — intentional business boundary, not equivalence. |

## Expenses — Payment JE retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bill payment list → payment JE → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | The Payment JE link now carries the originating Bill payment scope (Bill, selected payment date and Payments tab); Journal Entry displays `Back to Bill payments` rather than leaving the payment list. | PARTIAL — local return/build verified; QBO payment-JE click behavior is unobserved. |
| Payment workflow boundary | No fresh QBO evidence this cycle. | The link is navigation over retained payment evidence only. Bill Pay/ACH/card/check issuance, vendor portal/OCR, external sync, auto-match/post/refund, sales channels and email/export remain excluded. | PARTIAL — deliberate business scope, not QBO equivalence. |

## Accounting — Reconciliation history report-return scope (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Signed reconciliation history → GL / AP Aging / AR Aging → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | Each history-snapshot report handoff now carries the immutable snapshot id as well as account, period, cutoff, cash scope and mapped cash account. Target reports return to that snapshot, not the current worksheet. | PARTIAL — local return contract/build verified; QBO signed-history report drill behavior is unobserved. |

## Expenses — Payment bank evidence → GL/TB retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Payment → Bank evidence → GL Detail / TB → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | Both GL Detail and Trial Balance drills from full-page Payment bank evidence now preserve the original Bill-payment return context. The report Back returns to Bill payments rather than losing the payment origin. | PARTIAL — local navigation/build verified; QBO cross-page drill behavior is unobserved. |

## Expenses — Bill detail → JE retained return (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bill full-page detail → AP / payment / reversal JE → Back | No fresh QBO evidence: the read-only browser bridge returned no auditable tab. | The three JE drills preserve the source Bill id. Journal Entry now visibly returns to that full-page Bill rather than dropping into the Expenses list. | PARTIAL — local navigation/build verified; QBO bill-to-JE drill behavior remains unobserved. |

## P0: Global shell direct English labels (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Global navigation, sign-in, quick-create and empty states | No fresh QBO evidence: the read-only browser bridge returned no auditable tab on the QBO homepage. | Replaced localized source labels directly in the visible application shell with English labels, including navigation, sign-in, search, quick-create, user actions, error boundary and approval/audit empty states. The one-child `Journal Entry` and `Reports` navigation contract remains direct-route only; report drills remain full-page replacement views with Back. | PARTIAL — direct source-label, singleton-navigation and build checks pass; visual QBO comparison and every runtime route remain unobserved this cycle. |
| Expenses legacy tab context | No fresh QBO evidence this cycle. | Removed obsolete localized/malformed legacy tab aliases from the Expenses navigation context. The retained business-fit local scope is Bills, Payments, AP Aging and Vendors; the same list-to-full-page-evidence-detail-to-Back contract is preserved. | PARTIAL — local source/build verified; QBO Expenses tab labels and populated-page behavior remain unobserved. |

## Accounting: Chart of Accounts read-only English scope (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| COA local evidence, account drill and controls | No fresh QBO evidence: the read-only browser bridge returned no auditable tab (`tabs.list()` returned an empty list). | Removed dormant account-create drawer and account-write code as well as legacy localized tab aliases. COA now presents English-only reference/posting-account tabs, name-or-number filter, disabled write/export/batch controls, and retained Register/GL drills with return context. | PARTIAL — direct source, business boundary and build verification only; QBO COA layout, populated fields, permissions, audit and drill behavior remain unobserved. |

## Reports: English full-page statement and drill shell (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| TB, GL Detail, Balance Sheet, Income Statement and Cash Flow report shell | No fresh QBO evidence: the read-only browser bridge returned no auditable tab this cycle. | Normalized visible report category, tie-status, statement headings, dimension column, Reports Center breadcrumb and full-page GL drill labels to English. Amount drill still replaces the report with scoped transaction detail and `Back to [report]`; cash/control, CWIP/prepaid, restricted/escrow and related-party review boundaries remain explicit. | PARTIAL — local source/build drill contract verified; QBO reports catalog, layout, filters, permissions and populated drill behavior remain unobserved. |

## Accounting: Reconciliation English read-only shell (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Statement bridge, local evidence and signed-history drill | No fresh QBO evidence: the read-only browser bridge returned no auditable tab this cycle. | Replaced visible localized/malformed reconciliation labels with direct English. Removed dormant record/suspense/sign-off posting helpers; retained drill paths open full-page bank/JE/report evidence with explicit Back. Existing local review/reopen metadata remains separate from ledger evidence. | PARTIAL — source/read-only boundary/build verification only; QBO reconcile behavior, permissions, sign-off/audit, empty states and responsive layout remain unobserved. |

## Accounting: Bank Transaction evidence-only queue (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bank queue candidate review and full-page evidence drill | No fresh QBO evidence: the read-only browser bridge returned no auditable tab this cycle. | Removed dormant local categorize/match/batch action code and the inline match dialog. Queue rows now expose a read-only candidate explanation and explicit `Open evidence detail`; the detail retains its full-page Back path to the originating queue or report context. | PARTIAL — local source/build and return contracts are verified; QBO Bank transactions behavior, filters, match/categorize permissions, audit, empty states and responsive layout remain unobserved. |

## Receivables: Receipt evidence-only invoice list (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Invoice, Receipt and AR Aging drill chain | No fresh QBO evidence: the read-only browser bridge returned no auditable tab this cycle. | Replaced the open-invoice auto-receipt action with an explicit unavailable receipt-evidence control. Existing retained receipts still drill Invoice → full-page evidence → posted JE / exact bank credit / Reconcile and Back restores Invoice, Receipt filter, or AR Aging scope. | PARTIAL — local receipt boundary, evidence lifecycle and return contracts are verified; QBO Invoice/Receipt controls, permissions, audit, empty states and responsive layout remain unobserved. |

## Reports: business-fit catalog wording (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Retained Reports Center catalog and full-page drill context | No fresh QBO evidence: the read-only browser bridge returned no auditable tab this cycle. | Corrected the visible catalog language to `Core financial reports` and explicitly limits the workbench to retained financial statements, aging, and reconciliation evidence. The existing retained-name filter, full-page report/evidence detail, and Back-to-Reports-Center behavior remain unchanged; WBS control packs are not advertised as part of this business-fit report catalog. | PARTIAL — source, retained-scope, replacement-detail and build checks are local-only; QBO Reports catalog, permissions, populated rows and responsive behavior remain unobserved. |

## Navigation: one-destination parent affordance (2026-08-04)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Journal Entry and Reports parent navigation | No fresh QBO evidence: the read-only browser bridge returned no auditable tab this cycle. | A navigation group with one destination continues to route directly to that destination and never renders its duplicate child. The parent now also omits the expand/collapse caret, so `Journal Entry` and `Reports` visibly communicate direct navigation rather than a collapsed submenu. | PARTIAL — singleton route, absent duplicate child/caret and build checks are local-only; QBO navigation layout, permissions and responsive behavior remain unobserved. |

## Accounting: Cash and restricted-cash control drill (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Cash-control evidence report | Read-only QBO Banking audit (2026-08-05) showed account cards with separate Bank and Posted balances; Review / Posted / Excluded tabs; Search, date and transaction-type filters; and table columns for Date, Bank description, Spent, Received, Attach file, From/To, Match/Categorize, and Action. A populated restricted-cash control report was not observed. | A Reports Center control card opens a full-page Cash & Restricted Cash Control detail. It separates Operating, Restricted, Escrow, Security deposit, and Payroll restricted cash; it exposes only retained POSTED GL, Account Register, and mapped local Reconciliation evidence with explicit return state. | PARTIAL - local contract only; QBO report equivalence is not claimed. |
| Controller boundary | The same QBO page displayed Link account, Update accounts, Print, Export to CSV, AI suggestions, Match/Categorize and Post controls. Assistant3 and the current QB owner boundary require AP/AR/Bank/Reconcile/JE/GL/Close/Reports; WBS is read-only source/staging only. | No Construction Loan, Project Cost, Property Ops, bank connection, payment, matching, posting, adjustment, external sync, AI suggestion, or export action is added to this QB control report. Missing bank mapping remains unavailable rather than inferred. | PARTIAL - local business-fit boundary, not QBO equivalence. |

- Verification: `node verify-cash-restricted-control-return.mjs`, `node verify-reports-workbench-layout.mjs`, `node build.mjs`, and `git diff --check`. Browser audit remains read-only; populated QBO restricted-cash detail has not been observed.

## Expenses: Bill payment to bank-debit return chain (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Bill / Payment → exact Bank DEBIT → Reconcile → JE/GL/TB → Back | Earlier read-only QBO Banking evidence showed a review surface with Posted/Review states, amount columns, and match/categorize actions. No payment, match, or reconciliation operation was performed. | A Bill-origin Payment detail now carries entity, vendor, and payment-date context through its retained exact Bank DEBIT and reconciliation route. Reconciliation accepts that Bill-detail context and returns to the full-page Bill payment evidence rather than dropping to the payment list. Existing JE, GL Detail, and Trial Balance drills preserve the same payment origin. | PARTIAL - focused local return contract verified; QBO populated payment/reconcile, role, audit, empty-state, and responsive behavior are unobserved. |
| Controller safety boundary | No new QBO mutation evidence was collected. Assistant3 confirmed property-vendor, tax, loan/escrow, and related-party disbursement evidence must not default to operating cash. | Exact evidence requires the same POSTED payment JE, DEBIT direction, exact amount, entity and retained bank scope. The flow cannot pay, connect a bank, auto-match, clear, sign off, post, refund, export, or synchronize. | PARTIAL - local control contract, not QBO equivalence. |

- Verification: `node verify-ap-payment-bank-reconcile-return.mjs`, `node verify-expenses-ap-customer-flow.mjs`, and `git diff --check`.

## Accounting: COA cash-register scope return (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| COA → cash Register → Reconcile / GL/TB/BS → Back | Earlier read-only QBO Banking evidence showed separate bank and posted balances plus review/posted/excluded states. No COA, register, or reconciliation action was created or changed. | A cash Register launched from COA now propagates its COA tab/filter context into JE, GL, and Reconcile returns. After a full-page Reconcile or GL drill returns to Register, the user can return to the original filtered COA view. Entity, account, From/Through period and selected entry remain in the retained register context. | PARTIAL - local navigation/control contract verified; populated QBO COA/register behavior, roles, audit, empty state, and responsive layout remain unobserved. |
| Cash-only reconciliation boundary | No QBO mutation evidence collected. Assistant3 confirmed AP/AR, P&L, assets, liabilities, equity, and other non-cash accounts must never imply a bank statement or reconciliation scope. | Only locally classified cash accounts expose Register/Reconcile. Non-cash COA rows route to scoped GL Detail; Register Reconcile remains disabled without one entity-safe mapped bank account. No account write, feed, auto-match, post, export, or sign-off operation is added. | PARTIAL - local control boundary, not QBO equivalence. |

- Verification: `node verify-coa-register-cash-return.mjs` and `git diff --check`.

## Reports: More Options detail route (2026-08-04)

## Receivables: Customer payment to bank-credit return chain (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Customer Payment / Receipt → Bank CREDIT → Reconcile → JE/GL/TB → Back | Earlier read-only QBO Banking evidence showed a Bank transactions review surface with posted/review states and credit/received amounts. No QBO customer-payment or reconciliation drill sequence was operated or mutated. | Receipt rows now replace the list with a standalone Receipt detail page. Its retained receipt JE and exact Bank CREDIT drills carry the customer-receipts filter and report-date context. Existing Bank → Reconcile → JE/GL/TB return contexts can then lead back to that receipt detail; receipt Back restores the original receipts view. | PARTIAL - focused local contract verified only. Customer-payment permissions, audit-history UI, populated QBO flow, and responsive behavior remain unobserved. |
| Controller safety boundary | No new QBO mutation evidence was collected. Assistant3 confirmed that deposits, prepayments, escrow/restricted cash, owner collections, and cross-entity receipts must not default to AR. | The detail is explicitly read-only. It offers no collection, allocation, match, posting, reconcile, refund, export, or external-sync operation. Exact evidence requires a posted receipt JE, CREDIT direction, and exact amount; bank-cleared is explicitly not reconciliation sign-off. | PARTIAL - local control contract, not QBO equivalence. |

- Verification: `node verify-ar-receipt-bank-reconcile-return.mjs` and `git diff --check`. Full visual/build must be rerun by the release owner in the integration worktree because this isolated worktree's sandbox blocks esbuild directory traversal.

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Retained report row action and detail navigation | No fresh QBO evidence: the read-only browser bridge returned no auditable tab this cycle. | Replaced the report-row `More Options → Preview` state shortcut with `Open detail`, which uses the same retained report launch path as the row and primary action. Ledger/workflow reports now cannot bypass their full-page destination or its explicit Back path through this secondary menu. | PARTIAL — local source, full-page replacement and build checks are verified; QBO More Options contents, report access, audit and responsive behavior remain unobserved. |

## Reports: return scope through evidence drills (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Reports Center → statement/aging → source evidence → Back | No fresh QBO report drill was operated this cycle. The read-only QBO Banking audit remains limited to the previously observed review surface, so QBO report-category and search persistence is unverified. | The local report-return contract now nests the Reports Center target with the existing entity, period/as-of, property, project, loan, cash, account, and drill scope. Trial Balance, GL, Balance Sheet, Income Statement, Cash Flow, AP/AR Aging, source/JE, Account Register, and local Reconcile evidence recover it; the final Back fully replaces the detail page with Reports Center while retaining its report category and search query. | PARTIAL — focused local return-contract verification only; QBO populated report drills, permission behavior, empty states, and responsive interaction remain unobserved. |

- Verification: `node verify-reports-center-return-scope.mjs` and `git diff --check`. The release owner must rerun build/visual validation from the integration worktree before selecting this candidate.

## Journal Entry: controlled controller workflow (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| JE visible structure and full-page evidence review | Controller read-only QBO review observed Date, No., Account, Debit, Credit, Description, Name, Class, memo, attachment, totals, and history on the Journal Entry surface. No QBO entry was created, saved, posted, or exported. | The JE list/detail retains Date, Journal No., Account, Debit, Credit, Description/Memo, a controlled Name/Member field, Property/Project evidence, attachment state, totals, source trace, and visible retained workflow history. `Class` is intentionally not copied because its generic sales categorization is not a REFS accounting-control dimension. A scoped report/AP/AR/Bank/Reconcile/Register drill suppresses the conflicting generic list breadcrumb; its explicit full-page Back remains the only return path. | PARTIAL - local field and return contract verified; QBO labels, role behavior, attachment UI, populated history, and responsive layout remain unobserved. |
| Draft → Review → Approve → Post and SoD boundary | QBO direct save/post behavior is deliberately not adopted; no mutation was performed in the QBO session. Assistant3 review requires separate preparer/reviewer/approver/poster evidence and immutable posted history. | Removed UI affordances that batch-post, create batch entries, or cancel a posted entry back to editable status. New JE remains Draft-only; the existing controlled state machine and SoD verifier retain a per-JE Draft → Review → Approve → Post sequence. Posted entries remain view/reverse only; recurring/copy, external print/export, external attachment upload, and automatic posting remain unavailable. | PARTIAL - local UI/workflow contract verified; authoritative persistence and QBO equivalence are not claimed. |

- Verification: `node verify-je-controlled-workflow.mjs` and `git diff --check`. Build/visual must be rerun in the integration worktree before release selection.

## Expenses: Vendor, Bill, Payment, and AP Aging evidence return (2026-08-05)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Vendor → Bill / Payment / AP Aging → source or JE → Back | Earlier controller read-only QBO Vendors/Bills/Expenses audit established the reference surfaces. No QBO vendor, bill, payment, or export operation was performed this cycle. | Existing Vendor, Bill, Payment, and AP Aging details remain full-page retained-evidence views. A Vendor-selected Bill now carries the vendor search filter through Bill → AP JE, Payment JE, reversal JE, and Source Document drill contexts. Final Back returns to the selected Vendor evidence page with its original query; the Bill/Payment views retain entity, vendor, date, property/project, AP balance, and exact Bank DEBIT proof rather than inferring payment or reconciliation facts. | PARTIAL - local return and evidence contract verified; QBO populated fields, permissions, vendor/bill history, empty states, and responsive behavior remain unobserved. |
| AP evidence read-only boundary | No QBO mutation was made. Assistant3 business-fit review excludes Bill creation/editing, payment execution, ACH/check/card/wire rails, print/export, external connections, automatic match/allocation/posting, OCR/import, portals, email, and refund. | Removed the Bill-detail `Approve and create AP journal` control. Vendor/AP review exposes retained source, POSTED JE, exact Bank DEBIT, and Reconcile drill evidence only. Open AP is stated as original bill less effective POSTED payments and applied credits; no bill, payment, AP, bank, or reconciliation state is changed. | PARTIAL - local UI and verifier boundary only; not a QBO functional-equivalence claim. |

- Verification: `node verify-vendor-bill-payment-evidence-return.mjs` and `git diff --check`. Build/visual must be rerun from the integration worktree before release selection.

## Expenses: fixed evidence columns and read-only filters (2026-08-09)

| Capability | Newly observed QuickBooks evidence | REFS implementation | Status |
|---|---|---|---|
| Expenses entry point, empty state, and scoped Bill queue | Read-only QBO Expenses audit observed page heading `Expenses`; `Transaction Type: All transactions`; `Filter`; `Dates: Last 12 months`; disabled `Export to excel` and `Print`; and empty state `No expenses found / Try to change some filters to see more results.` No button, filter, export, print, or transaction action was invoked. | The REFS Expenses workspace retains Bills, Payments, AP Aging, and Vendors; Bills mirrors the observed Transaction type, Filter, and Last 12 months evidence scope, with the observed English empty-state guidance. It keeps extra business-fit status/vendor/category filters plus a full-page evidence drill and exact Back scope. The fixed table always exposes Due date alongside date, payee, category, amount, approval, and local proof. Export/print/settings are intentionally absent. | PARTIAL — direct QBO empty-state/filter evidence plus local implementation/offline verifiers passed. Populated QBO queue rows, permissions, detailed filter menu, audit history, responsive layout, and all mutation behavior remain unobserved. |
| Business-fit control boundary | QBO made `Record expense` visible, but the user requested a system-integrated accounting workflow rather than payment, payroll, sales, or external-connector replication. No QBO mutation was performed. | Removed the saved Columns/Customize-style preference from Expenses, including browser persistence. No create, pay, print, export, OCR, feed, provider connection, match, clear, post, or reconciliation action is exposed by this change. | PARTIAL — confirms a local read-only boundary; not QBO functional equivalence. |

- Verification: `npm.cmd run test:expenses-readonly-shell`, `npm.cmd run test:ap-ar`, `npm.cmd run build`, `npm.cmd run test:visual` (50/50 verifiers), and `git diff --check` all exit 0. The offline visual gate explicitly does not execute authenticated browser/API/OIDC E2E.
## Accounting: Chart of Accounts evidence without export (2026-08-09)

- **Observed QBO pattern:** Read-only QBO COA audit showed `Filter by name or number`, an `All` account-type filter, pagination, and table columns Name, Account type, QuickBooks balance, Bank balance, Action. A populated account row exposed `View register`. QBO also shows New account, batch editing, export, print, and settings; none was invoked.
- **REFS implementation:** the native COA evidence table retains name-or-number and Account type filters, and restores both through the existing Register/GL drillback context. Its balance is explicitly labelled `Posted ledger balance` rather than copying QBO's external Bank balance. The WBS reference chart is not exposed as a QBO-like COA tab; WBS remains source/staging evidence only. CSV export configuration has been removed, so this screen cannot imply a download workflow.
- **Status:** **PARTIAL** — direct QBO list/filter/column evidence plus REFS static/UI verification. QBO account permissions, action menus, register details, audit history, empty state, and responsive behavior remain unobserved. Account creation, editing, merge/delete, external balance feeds, download/print, connector actions, WBS administration, and any cash reconciliation mutation remain unavailable.
- **Verification:** `npm.cmd run test:coa-readonly-shell`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.

## Reports: remove saved-view and refresh-like controls (2026-08-09)

- **Observed QBO evidence:** unavailable this round because the signed-in QBO session returned to its sign-in page before Reports Center could be read. No authentication or business action was attempted.
- **REFS implementation:** retained reports continue to use entity/period/property/project/loan filters, full-page report or transaction detail, and explicit Back. Removed saved report scope persistence, refresh-like buttons, density controls, Cash-basis placeholder, and “more actions” affordances. Read-only Evidence scope remains available as an explanatory panel only.
- **Status:** **PARTIAL** — local source/UI verification only; QBO Reports category/search/launch/empty-state/permission/responsive evidence remains unobserved in this round. No customize, save, provider refresh, share, print, export, adjustment, mapping, payment, or posting path is exposed.
- **Verification:** `node verify-reports-readonly-catalog.mjs`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.

## Expenses: verified Filter popover scope (2026-08-09)

- **Observed QBO evidence:** A read-only authenticated Expenses audit opened the Filter popover without changing a value. It exposes `Status` (All statuses), `Delivery method` (Any), `Date` (Last 12 months), `From`, `To`, `Payee`, `Category`, `Reset`, `Apply`, and `Close`. The empty list remained `No expenses found / Try to change some filters to see more results.` Export and Print were disabled. No QBO transaction, filter, export, print, or setup action was submitted.
- **REFS implementation:** Bills now groups its retained Status, From/To, Payee, and Category evidence filters under `Filters`, matching the observed QBO information architecture. `Delivery method` is explicitly unavailable because REFS intentionally has no payment-provider or delivery-rail integration. The existing full-page Bill evidence detail and exact filter-restoring Back remain unchanged.
- **Status:** **PARTIAL** — QBO shell/filter fields and empty state were directly observed; REFS source/static verification is complete. QBO populated results, option values, permissions, audit history, date calculations, responsive behavior, and mutation behavior remain unverified and are not claimed. No external delivery, payment, print, export, connection, match, clear, post, or provider call is exposed.
- **Verification:** `node verify-expenses-readonly-shell.mjs`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.

## Navigation: Operations starts fresh at the first accounting workspace (2026-08-10)

- **Observed REFS defect:** Selecting the Operations rail item after visiting Intercompany kept the prior subpage visible. The user could not tell that Operations had been selected, and prior group state could remain in the left panel.
- **REFS implementation:** Every rail selection now replaces the open panel and enters the first visible destination. For Operations, WBS-only Project Cost, Unit Cost, Property Operations, Construction Loan, Amortization, and Accrual routes are excluded; the first visible page is `Closing Accounting`. A rail-entry revision remounts the workspace, so clicking Operations again cannot retain Intercompany local state. Singleton groups remain direct entries with no redundant child panel.
- **Status:** **VERIFIED LOCAL** — navigation contract, build, and offline static visual gate passed. This is a REFS navigation correction, not a claim about QBO equivalence. Authenticated browser/API E2E was not evaluated by the offline visual gate.
- **Verification:** `node verify-navigation-multi-expand.mjs`; `node verify-accounting-navigation-scope.mjs`; `npm.cmd run build`; `npm.cmd run test:visual` (51/51); `git diff --check`.

## Expenses: Bills page remains in a frozen full-page return context (2026-08-10)

- **Observed QBO evidence:** The authenticated, read-only QBO Expenses capture established the visible Bills toolbar, scoped Filter surface, and empty-state copy. It did not expose a populated second page or a detail-return interaction; no QBO page control or row action was selected.
- **REFS implementation:** The Bills list now owns its page alongside the retained queue, query, transaction type, date, vendor, and category scope. Bill and payment evidence carry this page into their full-page return context, Back restores it, and filter/queue/search changes deliberately reset the list to page 1. The generic table search is disabled for Bills so no hidden second query can break the visible return context.
- **Status:** **VERIFIED LOCAL** — focused local contracts, the existing Expenses shell verifier, build, and full visual suite verify the adapted behavior. QBO populated-page and browser-return behavior were not observed; no QBO equivalence is claimed.
- **Verification:** `node verify-expense-page-return-context.mjs`; `npm.cmd run test:expenses-readonly-shell`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.

## Expenses: authenticated primary-navigation scope (2026-08-10)

- **Observed QBO evidence:** A fresh, read-only authenticated Expenses DOM capture showed Main Navigation entries Home, Reports, Accounting, Expenses, Sales, Customers, Team, Time, Projects, Inventory, Sales Tax, Lending, and Payroll. The Expenses page also showed Purchase notifications, Print Checks, New transaction, a same-day deposit promotion, Transaction Type, Filter, Dates, disabled Export/Print, settings, and the empty state. No navigation entry or action was selected.
- **REFS adaptation:** REFS retains its accounting-shell domains: AP/AR, Bank, Reconcile, Journal, GL/Close, and Reports. Sales, customers, time, inventory, sales tax, lending, payroll, notification, check-printing, deposit-promotion, provider, and external-export surfaces remain excluded because they do not fit the requested controller accounting workflow.
- **Status:** **PARTIAL** — navigation labels and Expenses surface are directly observed; the business-fit exclusion is verified in the REFS UI contracts. QBO navigation permissions, expanded submenus, responsive layout, and populated list behavior remain unverified. This is scoped adaptation, not a claim of full QBO-navigation equivalence.
- **Verification:** `node verify-qb-business-fit-shell.mjs`; `node verify-expenses-readonly-shell.mjs`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.

## Accounting: COA page is retained through Register and GL evidence drills (2026-08-10)

- **Observed QBO evidence:** Prior authenticated, read-only QBO Chart of Accounts observation showed `Filter by name or number`, an `All` account-type filter, and pagination text `Showing accounts 1 to 200`; the populated-row `View register` affordance was observed without being selected. No account setup, batch action, print, or export control was used.
- **REFS implementation:** Chart of Accounts now freezes the current page with its name-or-number query and account-type filter when opening the existing Register or GL evidence drill. Back restores all three values. The list uses the observed 200-account page size; changing either filter returns to page 1. It remains evidence-only: no account create/edit/merge/delete, batch action, feed, print, download, or export behavior is added.
- **Status:** **PARTIAL** — the QBO list/filter/page structure is observed and the adapted local return contract is verified. QBO pagination semantics, account permissions, menu options, empty state, audit history, responsive behavior, and Register page behavior remain unverified; no account-management equivalence is claimed.
- **Verification:** `node verify-coa-page-return-context.mjs`; `npm.cmd run test:coa-readonly-shell`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.
# Reports Center: catalog page survives a full-page evidence drill (2026-08-10)

- **Observed QBO evidence:** The authenticated QBO Reports surface is available for read-only review. Earlier direct report-page navigation was not completed; this REFS behavior follows the confirmed product requirement that a report detail replaces the current screen and provides a Back path, rather than appending details below the report list.
- **REFS implementation:** The Reports Center freezes `category`, `search`, and the parent-owned catalog `reportPage` in every GL/control-report return context. Opening a report is a full-page replacement; Back restores the original filtered catalog page. Catalog search/category changes reset to page one. The workbench does not expose a second table-local search, report export, save, share, or customize action.
- **Verification:** `node verify-reports-page-return-context.mjs`; `node verify-reports-center-return-scope.mjs`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.
- **Status:** VERIFIED LOCAL for REFS return-context behavior; **PARTIAL** for QBO equivalence until the paginated Reports interaction is directly observed in the authenticated QBO session. No report-derived journal, payment, posting, export, or customization operation is enabled.

## Accounting Operations: automatic insurance amortization schedule (2026-08-10)

- **Observed product evidence:** The user confirmed the intended REFS business flow: a 12-month insurance coverage record is recognized and appears in the Amortization Center. No QBO transaction was created, edited, or posted.
- **REFS implementation:** Operations exposes Amortization Center and Accrual Center after Fixed Assets while Closing Accounting remains the first visible workspace. A retained 12-month insurance source automatically exposes a 12-line prepaid-insurance schedule with source trace and balanced monthly Draft previews. No automatic posting, payment, external provider call, or export is enabled.
- **Status:** **VERIFIED LOCAL** for navigation, automatic 12-period schedule, balance control, and Draft-only boundary. **PARTIAL** for production AI classification and QBO interaction behavior.
- **Verification:** `node verify-amortization-accrual-centers.mjs`; `node verify-navigation-multi-expand.mjs`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.

## REFS shell: unified navigation and report-summary icons (2026-08-10)

- **Observed product evidence:** The user-provided REFS Reports screenshot identified an unstyled rectangular `Review summary` control and mixed letter-square icons in secondary navigation as visually inconsistent with the line-icon rail.
- **REFS implementation:** Secondary navigation now maps every visible workspace to the shared self-authored stroke-icon set, removing colored letter-square tiles. `Review summary` is now a compact text action with the same line-icon language and an explicit `Open Balance Sheet summary` accessible name; it retains its existing read-only report launch.
- **Status:** **VERIFIED LOCAL** for icon treatment, accessible destination name, navigation behavior, build, and visual verifier suite. This is a REFS visual-system refinement, not a QBO icon-equivalence claim.
- **Verification:** `node verify-navigation-multi-expand.mjs`; `node verify-reports-readonly-catalog.mjs`; `node verify-a11y-offcanvas-and-dark-contrast.mjs`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.

## REFS shell: retained navigation badges and report/source visual hierarchy (2026-08-10)

- **Observed product evidence:** The user corrected the navigation decision: coloured letter-square badges remain in second-level navigation. A General Ledger screenshot also exposed default-button chrome around the retained-source labels (`CLOSING`, `AUTOC`), and the seven shared Balance Sheet/General Ledger snapshot metrics wrapped into two rows.
- **REFS implementation:** Secondary navigation again uses the distinct, coloured letter-square `nav-badge` treatment. Evidence/status labels remain compact round pills; source-drill buttons now reset browser border, background, outline, and shadow, so a clickable source has the same visual treatment as a non-clickable source. The seven report snapshot metrics are one horizontal, scrollable strip at every breakpoint rather than a split grid.
- **Status:** **VERIFIED LOCAL** for the styling and source/navigation contracts. It does not claim external QBO equivalence or authenticated production-browser validation.
- **Verification:** `node verify-badge-visual-contract.mjs`; `node verify-gl-overview-strip-layout.mjs`; `node verify-navigation-multi-expand.mjs`; `node verify-a11y-offcanvas-and-dark-contrast.mjs`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.

## REFS shell: lively but controlled icon color system (2026-08-10)

- **Observed product evidence:** The user requested a more lively icon and color system after reviewing the accounting shell, while retaining a professional controller workspace.
- **REFS implementation:** Each primary navigation family now carries the same restrained accent into its active rail glyph, hover glyph, and retained second-level letter badge. The treatments remain text-labelled and high-contrast; source/status evidence pills remain neutral in shape and continue to communicate status rather than decoration.
- **Status:** **VERIFIED LOCAL** for the shared visual contract and dark-mode contrast gate. This is REFS visual-system work, not a QBO-equivalence claim.
- **Verification:** `node verify-badge-visual-contract.mjs`; `node verify-a11y-offcanvas-and-dark-contrast.mjs`; `npm.cmd run build`; `npm.cmd run test:visual`; `git diff --check`.
