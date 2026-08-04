import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localBankTransactionJournalReturnContext } from './src/bank-transaction-return.js';

const bankUi = readFileSync(new URL('./src/module-banktx.jsx', import.meta.url), 'utf8');
const reportsUi = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
const bankReturn = localBankTransactionJournalReturnContext({acctCode:'BA-003',bankTxnId:'BT-42'});
assert.deepEqual(bankReturn, {route:'banktx',acctCode:'BA-003',bankTxnId:'BT-42',receiptReturn:null,reconciliationReturn:null});
assert.match(bankUi, /tab:'GL Detail'.*bankTransactionReturn:bankJournalReturn/, 'Bank GL drill retains the focused bank-evidence target');
assert.match(bankUi, /tab:'Trial Balance'.*bankTransactionReturn:bankJournalReturn/, 'Bank Trial Balance drill retains the focused bank-evidence target');
assert.match(reportsUi, /const bankTransactionReturn = preset\.bankTransactionReturn\?\.route === 'banktx'/, 'Reports recognize a retained bank origin');
assert.match(reportsUi, /bankTransactionReturn \? ctx\.goto\('banktx', bankTransactionReturn\)/, 'Reports Back returns to bank evidence before generic reports');
assert.match(reportsUi, /bankTransactionReturn \? 'Back to bank evidence'/, 'Reports expose the return action visibly');
console.log('bank report return: GL/TB drill retains full-page bank evidence return');
