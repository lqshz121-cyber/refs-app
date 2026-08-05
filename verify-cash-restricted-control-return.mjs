import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const reports = read('src/modules-more.jsx');
const capability = read('src/report-workflow-targets.js');
const reportReturn = read('src/report-return-context.js');

assert.match(capability, /Cash & Restricted Cash Control/, 'Cash control must be an explicit local report capability');
assert.match(capability, /state:'LOCAL_CONTROL'/, 'Cash control must not be labelled a generic preview');
assert.match(reports, /openReport:'Cash & Restricted Cash Control'/, 'GL/register/reconcile return must reopen the full-page cash-control detail');
assert.match(reports, /'Cash & Restricted Cash Control': \(\) =>/, 'Reports must render a dedicated cash-control detail');
assert.match(reports, /Operating cash, restricted cash, escrow, security deposits, and payroll-restricted funds remain distinct/, 'Cash scopes must remain explicitly segregated');
assert.match(reports, /Open GL detail/, 'Cash control must provide a ledger evidence drill');
assert.match(reports, /Open account register/, 'Cash control must provide a register evidence drill');
assert.match(reports, /Open local reconciliation/, 'Cash control must provide a reconciliation evidence drill');
assert.match(reports, /features=\{\{exportable:false\}\}/, 'Cash control table must not expose business-data export');
assert.match(reportReturn, /Retained local scope · entity/, 'Visible report return scope must use English separators');
assert.doesNotMatch(reports.match(/'Cash & Restricted Cash Control': \(\) =>[\s\S]*?(?=\n    'Construction Loan Rollforward')/)?.[0] || '', /Construction Loan|Project Cost|Property Ops/, 'QB cash-control detail must not introduce WBS project or construction-loan workflows');

console.log('PASS: cash/restricted-cash control is a read-only full-page report with scoped GL/register/reconcile returns.');
