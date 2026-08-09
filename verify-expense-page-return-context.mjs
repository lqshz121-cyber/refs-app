import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localExpenseDetailReturnScope, localExpenseDetailReturnScopeLabel } from './src/expense-detail-return.js';

const ap = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./src/ui.jsx', import.meta.url), 'utf8');
const payment = readFileSync(new URL('./src/payment-return-context.js', import.meta.url), 'utf8');

const scope = localExpenseDetailReturnScope({ billQueueView:'Unpaid', statusFilter:'APPROVED', dateRange:'CUSTOM', fromDate:'2026-07-01', toDate:'2026-07-31', expensePage:2 });
assert.equal(scope.expensePage, 2, 'A Bill detail return scope must retain the zero-based visible list page.');
assert.equal(localExpenseDetailReturnScopeLabel(scope), 'Return scope: Unpaid / APPROVED / 2026-07-01 to 2026-07-31 / Page 3', 'The full-page Bill header must visibly name the page Back restores.');
assert.match(ui, /page:controlledPage, onPageChange/, 'The shared table must permit a parent-owned page for a returnable full-page drill.');
assert.match(ap, /const \[expensePage, setExpensePage\] = useState\(0\)/, 'Bills must own the page in the Expenses workspace.');
assert.match(ap, /page=\{expensePage\} onPageChange=\{setExpensePage\}/, 'Bills must bind pagination to the frozen parent scope.');
assert.match(ap, /features=\{\{exportable:false,filterable:false\}\}/, 'Bills must not add a second, untracked grid search.');
assert.match(ap, /setExpensePage\(detailReturnScope\.expensePage\)/, 'Bill Back must restore the frozen parent page.');
assert.match(ap, /setExpensePage\(0\)/, 'A changed Bill query, filter, or queue must restart at page one.');
assert.match(ap, /localExpenseDetailReturnScopeLabel\(billReturnScope\)/, 'Bill detail must display the retained parent return scope.');
assert.match(payment, /expenseReturnScope\.expensePage/, 'Payment evidence must keep the same page visible through its downstream drill label.');
assert.doesNotMatch(ap, /Pay vendor|Post payment|Export payment|actions\.approveBill/, 'Page restoration must not create a payment, posting, or export action.');

console.log('PASS: Bills full-page evidence restores an exact parent page without adding an AP mutation surface.');
