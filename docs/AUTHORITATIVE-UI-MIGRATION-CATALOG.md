# Authoritative UI migration catalog

The legacy demonstration shell remains an explicit demonstration-only surface.
This catalog is the production replacement plan: every familiar workspace is
discoverable in the authoritative navigation, but only a signed-in API read
model may render accounting facts.

## One presentation system

REFS maintains **one presentation system**, not a separate demo design and
authoritative design. New authoritative UI work must extract or reuse the
demo's presentational JSX, tokens, layout, and responsive rules, then attach
an API/OIDC controller. The demo keeps only its fixture data and local action
controller; the authoritative build keeps only server-backed facts and
authorised commands. A parallel authoritative visual rewrite is not allowed.

| Legacy navigation area | Formal authoritative entry | Current state |
| --- | --- | --- |
| Dashboard | Control Center / Dashboard | API read: AP, AR, journal counts |
| Action Required, AI Audit, AI JE Workbench | Control Center | API read model unavailable |
| Core settings, Rule Center, Mapping Center | Accounting Settings | API read model unavailable |
| Accounting Staging, Source Documents, Integration Hub, Mapping Exceptions | Source & Staging | API read model unavailable |
| Bank Batch Pipeline, Checks & Payments | Auto Reconciliation | API read model unavailable |
| Bank Transaction Matching | Auto Reconciliation | API read: bank evidence and controlled match review |
| Reconciliation Worksheet | Auto Reconciliation | API read: reconciliation worksheet and lifecycle evidence |
| Journal Entries | Journal Entry | API read |
| GL, consolidation, account inquiry, subledger, COA | General Ledger | API read model unavailable as separate workspaces |
| Project Cost, unit cost, transfers, loans, pickup, close, intercompany, assets, amortization, accruals | Accounting Operations | API read model unavailable as separate workspaces |
| Month-End Close, Period Management | Close | API read model unavailable |
| Bills & expenses | Payables & Receivables | API read: AP list, evidence, aging |
| Invoices & receipts | Payables & Receivables | API read: AR list, evidence, aging |
| Financial statements | Reports | API read: statements, comparisons, cash flow, CWIP, loan, prepaid, intercompany, budget, consolidation evidence |
| Administration | Administration | API read model unavailable |

## Safety contract

- Production never imports `legacy-demo-app.jsx`, `seed.js`, `data.js`, or
  `repo.js` to satisfy an unavailable workspace.
- An unavailable entry displays its entity and period scope plus an explicit
  `API unavailable` state. Source & Staging entries also name the specific
  missing read contract, so a familiar legacy page is never mistaken for a
  live data view. It exposes no create, approve, pay, match, post, export, or
  synchronization action.
- New API contracts may promote exactly one catalog entry from unavailable to
  API read. They must add a client contract and tests before changing the UI
  state.
