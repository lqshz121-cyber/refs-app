import assert from 'node:assert/strict';
import { localBillPaymentEvidence } from './src/bill-payment-evidence.js';

const bill = {status:'PAID',amount:100,account_code:'641600',je_number:'AP-1',pay_je_number:'PAY-1'};
const journals = [
  {je_number:'AP-1',entity_id:4,posting_status:'POSTED',lines:[{account_code:'641600',debit_amount:100},{account_code:'291001',credit_amount:100}]},
  {je_number:'PAY-1',entity_id:4,posting_status:'POSTED',lines:[{account_code:'291001',debit_amount:100},{account_code:'111000',credit_amount:100}]},
];
const proof = localBillPaymentEvidence(bill,journals,[{match_status:'MATCHED',direction:'DEBIT',amount:100,matched_je:'PAY-1'}]);
assert.equal(proof.billState,'VALID_POSTED_AP');
assert.equal(proof.bankState,'BANK_MATCHED');
assert.equal(localBillPaymentEvidence({...bill,status:'APPROVED',pay_je_number:null},journals).paymentAllowed,true);
assert.equal(localBillPaymentEvidence(bill,journals,[{match_status:'MATCHED',direction:'DEBIT',amount:99,matched_je:'PAY-1'}]).bankState,'POSTED_UNMATCHED');
assert.equal(localBillPaymentEvidence(bill,[journals[0],{...journals[1],entity_id:2}]).paymentState,'CROSS_ENTITY_PAYMENT');
console.log('bill payment evidence: posted AP, exact cash payment, and bank-debit boundaries verified');
