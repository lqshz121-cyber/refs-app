import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localBankTransactionJournalReturnContext } from './src/bank-transaction-return.js';

const bankTx = readFileSync(new URL('./src/module-banktx.jsx', import.meta.url), 'utf8');

const origin = {
  queue:'Posted', query:'vendor wire', dateRange:'Last 90 days', type:'Money out', page:3,
  entityId:'ENTITY-01', receiptReturn:{route:'receipts',receiptId:'R-12'},
};
const result = localBankTransactionJournalReturnContext({acctCode:'BA-003',bankTxnId:'txn-44',origin});

assert.deepEqual(
  result,
  {
    route:'banktx', acctCode:'BA-003', bankTxnId:'txn-44', queue:'Posted', query:'vendor wire',
    dateRange:'Last 90 days', type:'Money out', page:3, entityId:'ENTITY-01',
    receiptReturn:{route:'receipts',receiptId:'R-12'}, reconciliationReturn:null,
  },
  'Bank → JE/GL/Reconcile returns must retain the originating evidence queue scope.'
);
assert.equal(localBankTransactionJournalReturnContext({acctCode:'',bankTxnId:'txn-44'}), null, 'A return requires a specific retained bank account.');
assert.match(bankTx, /setQueue\(navContext\.queue \|\| requestedFocus\.queue\)/, 'A deep return must restore the saved queue rather than infer it.');
assert.match(bankTx, /setQuery\(navContext\.query \?\? ''\)/, 'A deep return must restore the saved search query.');
assert.match(bankTx, /setDateRange\(navContext\.dateRange \|\| 'All dates'\)/, 'A deep return must restore the saved date range.');
assert.match(bankTx, /setType\(navContext\.type \|\| 'All transactions'\)/, 'A deep return must restore the saved transaction type.');
assert.match(bankTx, /bankTransactionReturn:bankJournalReturn/, 'Signed-history and Reconcile drills must share the same preserved Bank scope.');
assert.match(bankTx, /It cannot import, auto-match, categorize, post, clear, sign off, connect, pay or alter a statement\./, 'Bank evidence detail must remain read-only.');

console.log('PASS: Banking queue → detail → JE/GL/Reconcile → Back retains account, queue, query, date range, type and page without a mutation surface.');
