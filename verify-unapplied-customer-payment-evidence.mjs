import assert from 'node:assert/strict';
import { localUnappliedCustomerPayments, localUnappliedPaymentView } from './src/unapplied-customer-payment-evidence.js';

const invoices = [{inv_id:1,inv_no:'I-1',customer_name:'Tenant',amount:100,pay_je_number:'PAY-1'}];
const journals = [
  {je_number:'PAY-1',entity_id:4,je_date:'2026-07-10',source_system:'AR',posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:100},{account_code:'120200',credit_amount:100}]},
  {je_number:'PAY-2',entity_id:4,je_date:'2026-07-11',source_system:'AR',posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:40},{account_code:'225000',credit_amount:40}]},
  {je_number:'PAY-3',entity_id:4,je_date:'2026-07-12',source_system:'AR',posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:30},{account_code:'120200',credit_amount:30}]},
];
const rows = localUnappliedCustomerPayments(invoices,journals,[{matched_je:'PAY-1',match_status:'MATCHED',direction:'CREDIT',amount:100}]);
assert.equal(rows.length, 3);
assert.equal(rows[0].state, 'ALLOCATED');
assert.equal(rows[1].state, 'UNAPPLIED_PREPAYMENT_REVIEW');
assert.equal(rows[2].state, 'UNAPPLIED_AR_CASH_REVIEW');
assert.equal(localUnappliedPaymentView(rows,'Unapplied').length, 2);
console.log('unapplied customer payment evidence: allocated, prepayment, and unidentified-cash boundaries verified');
