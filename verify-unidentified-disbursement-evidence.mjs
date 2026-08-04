import assert from 'node:assert/strict';
import { localUnidentifiedDisbursementEvidence, localUnidentifiedDisbursementView } from './src/unidentified-disbursement-evidence.js';

const masters = [{bank_account_code:'BA-OP',entity_id:2,cash_scope:'Operating',gl_account_code:'111000'},{bank_account_code:'BA-ESC',entity_id:2,cash_scope:'Escrow',gl_account_code:'112000'}];
const bankTransactions = [
  {bank_txn_id:1,bank_account_code:'BA-OP',direction:'DEBIT',amount:900,match_status:'UNMATCHED'},
  {bank_txn_id:2,bank_account_code:'BA-OP',direction:'DEBIT',amount:500,match_status:'UNMATCHED'},
  {bank_txn_id:3,bank_account_code:'BA-ESC',direction:'DEBIT',amount:700,match_status:'UNMATCHED'},
];
const journals = [
  {je_number:'PAY-1',entity_id:2,posting_status:'POSTED',source_system:'EXPA',payee:'Vendor A',lines:[{account_code:'291001',debit_amount:900},{account_code:'111000',credit_amount:900}]},
  {je_number:'CWIP-1',entity_id:2,posting_status:'POSTED',payee:'Builder A',lines:[{account_code:'164200',debit_amount:500},{account_code:'111000',credit_amount:500}]},
  {je_number:'ESC-1',entity_id:2,posting_status:'POSTED',payee:'Escrow vendor',lines:[{account_code:'610000',debit_amount:700},{account_code:'112000',credit_amount:700}]},
];
const rows = localUnidentifiedDisbursementEvidence({bankTransactions,journals,bills:[{bill_id:1,pay_je_number:'PAY-1',vendor_name:'Vendor A'}],bankAccounts:masters});
assert.equal(rows[0].workflowState, 'INVESTIGATING');
assert.equal(rows[0].disbursementKind, 'AP_PAYMENT_CANDIDATE');
assert.equal(rows[0].bill.bill_id, 1);
assert.equal(rows[1].disbursementKind, 'CWIP_CANDIDATE');
assert.equal(rows[2].state, 'HELD_NON_OPERATING_CASH_SCOPE');
assert.equal(localUnidentifiedDisbursementView(rows,'Investigating').length, 2);
assert.equal(localUnidentifiedDisbursementView(rows,'Held unexplained').length, 1);
console.log('unidentified disbursement evidence: exact AP/CWIP candidates and held-cash boundaries verified');
