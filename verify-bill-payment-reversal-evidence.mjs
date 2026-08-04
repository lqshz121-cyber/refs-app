import assert from 'node:assert/strict';
import { localBillAppliedPaymentEvidence } from './src/vendor-credit-evidence.js';

const bill={bill_id:4,bill_no:'BILL-4',entity_id:2,vendor_id:9,vendor_name:'Concrete Co',amount:1000,pay_je_number:'PAY-4'};
const payment={je_number:'PAY-4',posting_status:'POSTED',entity_id:2,payee:'Concrete Co',je_date:'2026-07-10',lines:[{account_code:'291001',debit_amount:1000},{account_code:'111000',credit_amount:1000}]};
const reversal={je_number:'REV-4',je_type:'REVERSAL',posting_status:'POSTED',entity_id:2,je_date:'2026-07-20',history:[{a:'REVERSAL of PAY-4'}],lines:[{account_code:'291001',credit_amount:1000},{account_code:'111000',debit_amount:1000}]};
assert.equal(localBillAppliedPaymentEvidence(bill,[payment,reversal],'2026-07-15').paidAmount,1000);
const reversed=localBillAppliedPaymentEvidence(bill,[payment,reversal],'2026-07-31');
assert.equal(reversed.paidAmount,0);
assert.equal(reversed.state,'PAYMENT_REVERSED_EVIDENCE');
const bankBlocked=localBillAppliedPaymentEvidence(bill,[payment,reversal],'2026-07-31',[{match_status:'MATCHED',matched_je:'PAY-4'}]);
assert.equal(bankBlocked.paidAmount,1000);
assert.equal(bankBlocked.state,'PAYMENT_REVERSAL_BANK_REVIEW');
console.log('bill payment reversal: cutoff-aware retained reversal restores AP only without bank-match block');
