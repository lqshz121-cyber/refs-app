import { BANK_TRANSACTION_PAGE_SIZE, pageBankTransactionEvidence } from './src/bank-transaction-pagination.js';
import { bankTransactionFocus } from './src/bank-transaction-focus.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rows = Array.from({length:101}, (_, index) => ({bank_txn_id:index + 1}));
const first = pageBankTransactionEvidence(rows);
const second = pageBankTransactionEvidence(rows, 2);
const last = pageBankTransactionEvidence(rows, 9);
const empty = pageBankTransactionEvidence([]);

assert(BANK_TRANSACTION_PAGE_SIZE === 50, 'QBO-observed local page size remains 50');
assert(first.start === 1 && first.end === 50 && first.rows.length === 50 && first.pageCount === 3, 'first page is bounded');
assert(second.start === 51 && second.end === 100 && second.rows[0].bank_txn_id === 51, 'middle page advances');
assert(last.currentPage === 3 && last.start === 101 && last.end === 101, 'out-of-range pages clamp');
assert(empty.currentPage === 1 && empty.start === 0 && empty.end === 0 && empty.rows.length === 0, 'empty state stays on page one');
const focusRows = Array.from({length:101}, (_, index) => ({bank_txn_id:index + 1, _state:index < 75 ? 'Review' : 'Posted'}));
const reviewFocus = bankTransactionFocus(focusRows, 75);
assert(reviewFocus.found && reviewFocus.queue === 'Review' && reviewFocus.page === 2 && reviewFocus.transaction === focusRows[74], 'a focused review transaction opens its local queue page');
const postedFocus = bankTransactionFocus(focusRows, 101);
assert(postedFocus.found && postedFocus.queue === 'Posted' && postedFocus.page === 1 && postedFocus.transaction === focusRows[100], 'page calculation scopes to the focused queue');
const missingFocus = bankTransactionFocus(focusRows, 999);
assert(!missingFocus.found && missingFocus.queue === null && missingFocus.page === 1 && missingFocus.transaction === null, 'missing evidence cannot be focused');
console.log('bank transaction pagination verification passed');
