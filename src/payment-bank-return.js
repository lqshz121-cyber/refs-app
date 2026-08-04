export function localPaymentBankReturn({ bill, bankTransaction, paymentDate = 'All dates' } = {}) {
  if (!bill?.bill_id || !bankTransaction?.bank_account_code || !bankTransaction?.bank_txn_id) return null;
  return { route: 'ap', tab: 'Payments', billId: bill.bill_id, paymentDate };
}

export function localBankReconcileReturn({ acctCode, bankTxnId, paymentReturn } = {}) {
  if (!acctCode || !bankTxnId || !paymentReturn?.billId) return null;
  return { route: 'banktx', acctCode, bankTxnId, paymentReturn };
}
