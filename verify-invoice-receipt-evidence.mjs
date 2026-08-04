import assert from 'node:assert/strict';
import { localInvoiceReceiptEvidence } from './src/invoice-receipt-evidence.js';

const journals = [
  {je_number:'INV-1-JE',entity_id:4,posting_status:'POSTED',lines:[{account_code:'120200',debit_amount:100},{account_code:'421803',credit_amount:100}]},
  {je_number:'RCT-1-JE',entity_id:4,posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:100},{account_code:'120200',credit_amount:100}]},
];
const paid = localInvoiceReceiptEvidence({amount:100,status:'PAID',je_number:'INV-1-JE',pay_je_number:'RCT-1-JE'}, journals, [{match_status:'MATCHED',direction:'CREDIT',amount:100,matched_je:'RCT-1-JE'}]);
assert.equal(paid.sourceState, 'VALID_POSTED_AR_SOURCE');
assert.equal(paid.receiptState, 'BANK_MATCHED');
assert.equal(localInvoiceReceiptEvidence({amount:100,status:'OPEN',je_number:'MISSING'}, journals).receivePaymentAllowed, false, 'an unproven source cannot receive a local payment');
assert.equal(localInvoiceReceiptEvidence({amount:100,status:'PAID',je_number:'INV-1-JE',pay_je_number:'RCT-1-JE'}, journals, [{match_status:'MATCHED',direction:'CREDIT',amount:99,matched_je:'RCT-1-JE'}]).receiptState, 'POSTED_UNMATCHED', 'a non-exact bank credit is not a matched receipt');
assert.equal(localInvoiceReceiptEvidence({amount:100,status:'PAID',je_number:'INV-1-JE',pay_je_number:'RCT-1-JE'}, [{...journals[0]},{...journals[1],entity_id:2}]).receiptState, 'CROSS_ENTITY_RECEIPT');
console.log('invoice receipt evidence: posted AR, exact local receipt, and bank-credit boundaries verified');
