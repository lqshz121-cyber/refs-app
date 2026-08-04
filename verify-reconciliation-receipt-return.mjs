import assert from 'node:assert/strict';
import { localReconciliationPaymentReturnTarget, localReconciliationReceiptReturnTarget } from './src/reconciliation-receipt-return.js';

assert.deepEqual(
  localReconciliationReceiptReturnTarget({bankTransactionReturn:{route:'banktx',acctCode:'BA-003',bankTxnId:'BT-42',arReturn:{route:'ar',tab:'Receipts',receiptView:'Bank matched',asOfDate:'2026-07-31'}}}),
  {route:'ar',context:{route:'ar',tab:'Receipts',receiptView:'Bank matched',asOfDate:'2026-07-31'},label:'Back to customer receipts'},
);
assert.equal(localReconciliationReceiptReturnTarget({bankTransactionReturn:{route:'banktx',arReturn:{route:'ar',tab:'AR Aging'}}}), null);
assert.equal(localReconciliationReceiptReturnTarget({}), null);
assert.equal(localReconciliationReceiptReturnTarget(null), null, 'the standalone reconciliation route has no return context');
assert.deepEqual(
  localReconciliationPaymentReturnTarget({bankTransactionReturn:{route:'banktx',acctCode:'BA-003',bankTxnId:'BT-43',paymentReturn:{route:'ap',tab:'Payments',billId:19,paymentDate:'This month'}}}),
  {route:'ap',context:{route:'ap',tab:'Payments',billId:19,paymentDate:'This month'},label:'Back to Bill payments'},
);
assert.equal(localReconciliationPaymentReturnTarget({bankTransactionReturn:{paymentReturn:{route:'ap',tab:'AP Aging',billId:19}}}), null);
assert.equal(localReconciliationPaymentReturnTarget(null), null, 'the standalone reconciliation route has no payment return context');
console.log('reconciliation receipt return: only preserved AR Receipts scope may return');
