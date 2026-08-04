import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const arUi = readFileSync(new URL('./src/module-ar.jsx', import.meta.url), 'utf8');
const journalUi = readFileSync(new URL('./src/modules-core.jsx', import.meta.url), 'utf8');
const bankReturn = readFileSync(new URL('./src/bank-transaction-return.js', import.meta.url), 'utf8');

assert.match(arUi, /const invoiceEvidenceReturn = \{route:'ar',[\s\S]*?invoiceId:invoice\.inv_id,[\s\S]*?invoiceReturn:returnScope/, 'Invoice detail creates an exact retained return scope');
assert.match(arUi, /jeNumber:invoice\.pay_je_number,arReturn:invoiceEvidenceReturn/, 'Receipt JE returns to the originating invoice');
assert.match(arUi, /bankTxnId:invoice\.localEvidence\.exactBankCredits\[0\]\.bank_txn_id,arReturn:invoiceEvidenceReturn/, 'Exact bank credit returns to the originating invoice');
assert.match(journalUi, /returnToInvoice = ctx\.navContext\?\.arReturn\?\.route === 'ar' && ctx\.navContext\.arReturn\.invoiceId/, 'Journal Entry recognizes an invoice-detail origin');
assert.match(journalUi, /Back to Invoice detail/, 'Journal Entry visibly returns to the Invoice detail');
assert.match(bankReturn, /invoiceId \? 'Back to Invoice detail' : 'Back to customer receipts'/, 'Bank evidence differentiates invoice and customer-receipt return origins');
console.log('invoice evidence return: JE and exact Bank CREDIT retain the originating invoice detail scope');
