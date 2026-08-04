import assert from 'node:assert/strict';
import { localCustomerPaymentRows, localCustomerPaymentView } from './src/customer-payment-evidence.js';

const journals = [
  {je_number:'INV-1',entity_id:4,posting_status:'POSTED',lines:[{account_code:'120200',debit_amount:100}]},
  {je_number:'PAY-1',entity_id:4,posting_status:'POSTED',je_date:'2026-07-20',lines:[{account_code:'111000',debit_amount:100},{account_code:'120200',credit_amount:100}]},
  {je_number:'INV-2',entity_id:4,posting_status:'POSTED',lines:[{account_code:'120200',debit_amount:50}]},
  {je_number:'PAY-2',entity_id:4,posting_status:'POSTED',je_date:'2026-07-21',lines:[{account_code:'111000',debit_amount:50},{account_code:'120200',credit_amount:50}]},
];
const invoices = [
  {inv_id:1,inv_no:'I-1',customer_id:1,customer_name:'Tenant',amount:100,status:'PAID',je_number:'INV-1',pay_je_number:'PAY-1'},
  {inv_id:2,inv_no:'I-2',customer_id:2,customer_name:'Owner',amount:50,status:'PAID',je_number:'INV-2',pay_je_number:'PAY-2'},
  {inv_id:3,inv_no:'I-3',customer_id:3,customer_name:'Open tenant',amount:10,status:'OPEN',je_number:'INV-1'},
];
const rows = localCustomerPaymentRows(invoices, journals, [{bank_txn_id:7,bank_account_code:'BA-003',match_status:'MATCHED',direction:'CREDIT',amount:100,matched_je:'PAY-1'}]);
assert.equal(rows.length, 2, 'only retained receipt JEs become customer-payment rows');
assert.equal(rows[0].state, 'BANK_MATCHED', 'exact local bank credit marks a customer payment matched');
assert.equal(rows[1].state, 'POSTED_UNMATCHED', 'a posted receipt without exact bank credit remains unmatched');
assert.equal(localCustomerPaymentView(rows, 'Bank matched').length, 1, 'matched view is evidence scoped');
assert.equal(localCustomerPaymentView(rows, 'Posted unmatched').length, 1, 'unmatched view is evidence scoped');
console.log('customer payment evidence: invoice, receipt JE, and exact bank-credit views verified');
