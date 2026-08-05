# REFS Real Estate Financial System

REFS is WanBridge's real-estate accounting platform: an Accounting Kernel,
property and project accounting workspaces, bank/AP/AR controls, financial
statements, and an AI Accounting review layer.

Live static application: <https://lqshz121-cyber.github.io/refs-app/>

The Pages deployment demonstrates the current UI and local/mock accounting
workflows. It is not evidence of a production API, identity provider, attachment
provider, or real WBS connection.

## Product principles

- Every journal must balance: debit equals credit.
- Every automatic journal requires immutable source, rule, mapping, setting,
  idempotency, entity, period, and member trace.
- Closed periods, missing source evidence, ambiguous mappings, and unbalanced
  lines fail closed.
- Posted journals, ledger lines, audit events, and source trace are append-only.
- AI proposes and explains work; it never bypasses review, approval, or posting
  controls.
- WBS is read-only. The current implementation uses a replaceable mock adapter;
  real WBS production access is intentionally deferred.

## Main accounting flow

```text
Source receipt
  -> Raw / Normalized
  -> Staging or exception
  -> deterministic accounting event and rule result
  -> suggested Draft JE
  -> Review
  -> Approve
  -> Post
  -> General Ledger
  -> Trial Balance / Balance Sheet / Income Statement / Cash Flow
  -> AI Audit and analysis
```

## Implemented workspaces

- Dashboard and controller action queues
- AI Audit Center and AI JE Workbench
- Accounting Staging, Source Documents, Integration Hub, and Mapping Exceptions
- Journal Entry workflow and General Ledger
- Trial Balance, Balance Sheet, Income Statement, Cash Flow, AP/AR Aging, and
  reconciliation evidence
- Bills, payments, vendor credits, invoices, receipts, vendors, and customers
- Bank transactions and reconciliation worksheet/history
- Chart of Accounts, Account Register, and subsidiary evidence
- Project Cost/CWIP, Unit Cost, Unit Transfer, Fixed Assets, Prepaids,
  Amortization, Accruals, Intercompany, and Construction Loans
- Month-end close, permissions, audit trail, attachment boundaries, and release
  gates

## WBS mock accounting coverage

The mock connector and deterministic rule engine cover payable recognition,
payment exceptions, loan draws, interest capitalization, prepaid insurance,
amortization, accrual candidates, duplicate invoices, missing source, cutoff,
rent-roll mismatch, loan reconciliation, bank exceptions, and manual-JE risk.

See:

- [WBS-SOURCE-CONTRACT.md](WBS-SOURCE-CONTRACT.md)
- [outputs/REFS-WBS-MOCK-ACCOUNTING-READINESS.md](outputs/REFS-WBS-MOCK-ACCOUNTING-READINESS.md)
- [contracts/E2E-SCENARIOS.md](contracts/E2E-SCENARIOS.md)
- [REFS-ARCHITECTURE-V2.md](REFS-ARCHITECTURE-V2.md)

## Local setup

Requirements: Node.js, npm, Docker, and PowerShell on Windows for the command
examples below.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
```

The production-style API is in `server/`:

```powershell
npm.cmd --prefix server ci
npm.cmd --prefix server test
```

Fresh PostgreSQL gates:

```powershell
$env:POSTGRES_IMAGE='postgres:16-alpine'
npm.cmd --prefix server run test:postgres:fresh

$env:POSTGRES_IMAGE='postgres:15-alpine'
npm.cmd --prefix server run test:postgres:fresh
```

## Focused WBS mock verification

```powershell
npm.cmd run test:wbs-accounting-foundation
npm.cmd run test:wbs-accounting-acceptance
node verify-wbs-e2e-flow-evidence.mjs
node verify-wbs-report-impact.mjs
```

No command above calls real WBS production.

## Release boundary

Local tests and GitHub Pages are not a global production release. A production
claim additionally requires raw exit evidence for:

- a deployed HTTPS API and OIDC session, including authenticated `200`, anonymous
  `401`, and token-refresh proof;
- authenticated eight-page browser evidence for Dashboard, Reports, Reconcile,
  Bank Transactions, Expenses, Accounting, Rule Center, and Integration Hub;
- provider-backed object upload, versioned scan, exact-version deletion, and
  cleanup;
- a signed, nonempty, read-only WBS receipt when real WBS access is eventually
  authorized.

The external evidence verifier is fail-closed:

```powershell
npm.cmd run verify:external-release-gate
```

Without the required provider configuration and artifacts, it exits nonzero by
design.

## Repository map

- `src/`: React UI, accounting helpers, mock adapter, and deterministic rules
- `server/`: API, PostgreSQL kernel, migrations, OIDC, attachments, and WBS
  read-only boundary
- `tests/`: root application and contract tests
- `server/tests/`: API/kernel/provider-boundary tests
- `contracts/`: state machines, error codes, fixtures, and source contracts
- `outputs/`: readiness matrices and audit artifacts
- `tools/`: verifiers, local release simulation, and evidence-bundle tooling

Contributor guardrails are defined in [AGENTS.md](AGENTS.md).
