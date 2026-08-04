import assert from 'node:assert/strict';
import { localInvoicePaymentLifecycle } from './src/invoice-payment-lifecycle.js';

const journals = [
  {je_number:'INV-1',entity_id:4,posting_status:'POSTED',lines:[{account_code:'120200',debit_amount:100}]},
  {je_number:'RCT-1',entity_id:4,posting_status:'POSTED',lines:[{account_code:'111000',debit_amount:100},{account_code:'120200',credit_amount:100}]},
];
const paid = localInvoicePaymentLifecycle({status:'PAID',amount:100,je_number:'INV-1',pay_je_number:'RCT-1'}, journals, [{match_status:'MATCHED',direction:'CREDIT',amount:100,matched_je:'RCT-1'}]);
assert.equal(paid.invoiceState, 'POSTED_PAID');
assert.equal(paid.paymentState, 'RECORDED_POSTED');
assert.equal(paid.bankState, 'BANK_MATCHED');
const open = localInvoicePaymentLifecycle({status:'OPEN',amount:100,je_number:'INV-1'}, journals);
assert.equal(open.invoiceState, 'POSTED_OPEN');
assert.equal(open.paymentState, 'NO_RETAINED_PAYMENT');
assert.equal(open.bankState, 'NO_EXACT_BANK_CREDIT');
const missing = localInvoicePaymentLifecycle({status:'OPEN',amount:100,je_number:'MISSING'}, journals);
assert.equal(missing.invoiceState, 'REVIEW_MISSING_SOURCE_JE');
console.log('invoice payment lifecycle: posting, payment, and bank facts remain independent');
