// A receipt-origin reconciliation view is read-only navigation. It may return
// only to the preserved AR receipt scope; it never clears, signs off, or links
// a bank item merely because the user opened the worksheet.
export function localReconciliationReceiptReturnTarget(navContext = {}) {
  const arReturn = navContext?.bankTransactionReturn?.arReturn;
  if (arReturn?.route !== 'ar' || arReturn.tab !== 'Receipts') return null;
  return {route:'ar', context:arReturn, label:'Back to customer receipts'};
}

export function localReconciliationPaymentReturnTarget(navContext = {}) {
  const paymentReturn = navContext?.bankTransactionReturn?.paymentReturn;
  if (paymentReturn?.route !== 'ap' || paymentReturn.tab !== 'Payments' || !paymentReturn.billId) return null;
  return {route:'ap', context:paymentReturn, label:'Back to Bill payments'};
}
