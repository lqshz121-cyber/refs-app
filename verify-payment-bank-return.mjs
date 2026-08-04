import assert from 'node:assert/strict';
import { localPaymentBankReturn, localBankReconcileReturn } from './src/payment-bank-return.js';

const bill = { bill_id: 'BILL-101' };
const bankTransaction = { bank_account_code: '111000', bank_txn_id: 'BANK-101' };
const paymentReturn = localPaymentBankReturn({ bill, bankTransaction, paymentDate: '2026-07' });
assert.deepEqual(paymentReturn, { route: 'ap', tab: 'Payments', billId: 'BILL-101', paymentDate: '2026-07' });
assert.equal(localPaymentBankReturn({ bill, bankTransaction: {} }), null);
assert.deepEqual(localBankReconcileReturn({ acctCode: '111000', bankTxnId: 'BANK-101', paymentReturn }), { route: 'banktx', acctCode: '111000', bankTxnId: 'BANK-101', paymentReturn });
assert.equal(localBankReconcileReturn({ acctCode: '111000', bankTxnId: 'BANK-101' }), null);
console.log('payment-bank-return: OK');
