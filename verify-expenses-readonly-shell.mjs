import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_EXPENSE_COLUMNS } from './src/expense-listing.js';

const workspace = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');

assert.equal(DEFAULT_EXPENSE_COLUMNS.DUE_DATE, true, 'Due date must remain visible in the fixed Bill evidence view.');
assert.match(workspace, /\{key:'DUE_DATE',h:'Due date',k:'due_date'\}/, 'Bills must render the retained due date field.');
assert.match(workspace, /<Tabs tabs=\{\['Bills','Payments','AP Aging','Vendors'\]\}/, 'The native Expenses shell must retain its four read-only evidence areas.');
assert.match(workspace, />Filter<\//, 'The Bill list must retain the QBO-observed, read-only Filter entry point.');
assert.match(workspace, /Transaction Type/, 'The Bill list must retain the QBO-observed transaction-type scope.');
assert.match(workspace, /Last 12 months/, 'The Bill list must retain the QBO-observed default date window.');
assert.match(workspace, /'Filters'/, 'The Filter popover must use the observed concise QBO information label.');
assert.match(workspace, /Status <select value=\{statusFilter\}/, 'The Filter popover must retain the QBO-observed status scope.');
assert.match(workspace, /Delivery method<\/b><Unavailable reason="REFS does not connect payment providers or delivery rails/, 'Unsupported payment delivery must be explicitly unavailable rather than copied as an integration.');
assert.match(workspace, /Apply filters/, 'The Filter popover must retain an explicit local Apply action.');
assert.match(workspace, /No expenses found\. Try to change some filters to see more results\./, 'The Bill list must retain the QBO-observed English empty state.');
assert.match(workspace, /Back returns to this queue with its filters intact/, 'Full-page Bill detail must explain scope-restoring Back behavior.');
assert.doesNotMatch(workspace, /refs_expense_columns|localStorage\.setItem\('refs_expense_columns'/, 'Expenses must not persist QBO-style column customization.');
assert.doesNotMatch(workspace, /shellPanel==='Settings'|>Columns<|toggleColumn|columnVisibility/, 'Expenses must not expose a saved Columns/Customize control.');
assert.doesNotMatch(workspace, /Pay selected|Pay vendors|Print Checks|Export to Excel|Customize/, 'The read-only Expenses shell must not expose unsupported actions.');

console.log('PASS: Expenses uses fixed, auditable Bill evidence columns with a visible due date; filters and full-page Back remain read-only.');
