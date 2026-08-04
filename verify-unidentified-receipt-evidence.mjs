import assert from 'node:assert/strict';
import { localUnidentifiedReceiptEvidence, localUnidentifiedReceiptView } from './src/unidentified-receipt-evidence.js';

const masters = [
  {bank_account_code:'BA-OP',entity_id:2,cash_scope:'Operating',gl_account_code:'111000'},
  {bank_account_code:'BA-ESC',entity_id:2,cash_scope:'Escrow',gl_account_code:'112000'},
];
const bankTransactions = [
  {bank_txn_id:1,bank_account_code:'BA-OP',direction:'CREDIT',amount:2000,match_status:'UNMATCHED'},
  {bank_txn_id:2,bank_account_code:'BA-OP',direction:'CREDIT',amount:500,match_status:'UNMATCHED'},
  {bank_txn_id:3,bank_account_code:'BA-ESC',direction:'CREDIT',amount:700,match_status:'UNMATCHED'},
];
const journals = [
  {je_number:'RCPT-1',entity_id:2,posting_status:'POSTED',payee:'Tenant A',lines:[{account_code:'111000',debit_amount:2000},{account_code:'120200',credit_amount:2000}]},
  {je_number:'PP-1',entity_id:2,posting_status:'POSTED',payee:'Tenant B',lines:[{account_code:'112000',debit_amount:700},{account_code:'225000',credit_amount:700}]},
];
const rows = localUnidentifiedReceiptEvidence({bankTransactions,journals,invoices:[{inv_id:1,pay_je_number:'RCPT-1',customer_name:'Tenant A'}],bankAccounts:masters});
assert.equal(rows[0].workflowState, 'INVESTIGATING');
assert.equal(rows[0].state, 'EXACT_LOCAL_RECEIPT_CANDIDATE_REVIEW');
assert.equal(rows[0].invoice.inv_id, 1);
assert.equal(rows[1].state, 'UNIDENTIFIED_CREDIT_REVIEW');
assert.equal(rows[2].state, 'HELD_NON_OPERATING_CASH_SCOPE');
assert.equal(localUnidentifiedReceiptView(rows,'Investigating').length, 1);
assert.equal(localUnidentifiedReceiptView(rows,'Held as unapplied').length, 2);
console.log('unidentified receipt evidence: exact candidate, held cash scope, and no-auto-allocation boundaries verified');
