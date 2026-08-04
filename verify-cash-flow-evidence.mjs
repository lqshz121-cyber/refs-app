import assert from 'node:assert/strict';
import { buildLocalCashFlow } from './src/cash-flow-evidence.js';
const journal = (je, lines, source_system='PM') => ({je_number:je, je_date:'2026-07-01', source_system, lines});
const drCash = amount => ({account_code:'111000',debit_amount:amount,credit_amount:0});
const crCash = amount => ({account_code:'111000',debit_amount:0,credit_amount:amount});
const drEscrow = amount => ({account_code:'112000',debit_amount:amount,credit_amount:0});
const flow = buildLocalCashFlow({
  openingJournals:[journal('OPEN',[drCash(100),drEscrow(30)])],
  periodJournals:[journal('OP',[drCash(25),{account_code:'421803',credit_amount:25}]), journal('INV',[crCash(40),{account_code:'164200',debit_amount:40}],'CLS'), journal('FIN',[drCash(70),{account_code:'270100',credit_amount:70}],'WBS_CL'), journal('IC',[crCash(5),{account_code:'291001',debit_amount:5}],'MAN'), journal('ESC',[drEscrow(15),{account_code:'225000',credit_amount:15}],'PM')],
});
assert.deepEqual([flow.openingCash,flow.operating,flow.investing,flow.financing,flow.closingCash], [100,25,-40,70,150]);
assert.equal(flow.unclassified.length, 1);
assert.equal(flow.reconciliationDifference, -5);
assert.deepEqual(flow.cashAccounts,['111000']);
assert.deepEqual(flow.scopes, [{scope:'Escrow',openingCash:30,movement:15,closingCash:45},{scope:'Operating',openingCash:100,movement:50,closingCash:150}]);
assert.equal(flow.totalClosingCash,195);
console.log('cash flow evidence: operating flow and restricted/escrow scope reconciliation stay separate');
