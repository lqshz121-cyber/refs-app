# Internal test environment — WBS mock and reporting

This guide is for an isolated internal demonstration. It uses only the repository's deterministic **WBS mock connector** and local browser storage. It makes no network request to WBS or QBO, has no provider credentials, and is not a production accounting environment.

## Start

```powershell
npm.cmd ci
npm.cmd run build
npx serve dist -l 4173
```

Open `http://localhost:4173`. The dashboard and report pages load the included test data. In **AI Audit Center**, use **Run rules again** to rebuild the local WBS accounting analysis, action queue, source-to-report trace, and report-impact views.

## What can be tested

- WBS-shaped test entities, projects, vendors, AP invoices, bank rows, construction loan activity, rent roll, property tax, source documents, journals, and accounting periods.
- Deterministic accounting findings, source-backed Draft suggestions, controller-review gates, a posted mock ledger projection, trial balance, income statement, balance sheet, cash flow, and drillable WBS flow evidence.
- Reports and the AI Audit Center can be exercised repeatedly. Refreshing or rerunning rules does not contact WBS/QBO.

## Fast verification

```powershell
npm.cmd run test:wbs-accounting-foundation
npm.cmd run test:wbs-accounting-acceptance
node verify-wbs-e2e-flow-evidence.mjs
node verify-wbs-report-impact.mjs
```

The acceptance test verifies 16 mock accounting requirements, including balanced trial balance, source-to-GL flow, report impact, WBS end-to-end evidence, and review-only exception handling.

## Boundaries

This mode intentionally does **not** use the live WBS bridge, real provider snapshots, user identity, production posting, external report export, attachment scanning, or QBO integration. It is not evidence for production availability or a substitute for signed WBS source admission. The authoritative UI and its `WBS_TEST_IMPORT_MODE` remain separately fail-closed.