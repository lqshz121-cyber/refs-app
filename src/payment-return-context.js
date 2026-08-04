// A read-only navigation label. It makes the origin of a payment-bank-reconcile
// drill visible without looking up or changing the underlying Bill.
export function localPaymentReturnScopeLabel(context = {}) {
  const payment = context?.paymentReturn || context || {};
  return `Retained payment scope · bill ${payment.billId || 'unselected'} · date ${payment.paymentDate || 'All dates'} · ${payment.tab || 'Payments'}`;
}

export function localPaymentReportDrillContext({ tab = 'GL Detail', entityId = '', drillLabel = '', paymentReturn = null } = {}) {
  return {
    route:'gl', tab, entityId:entityId == null ? '' : String(entityId), drillLabel:String(drillLabel || ''),
    paymentReturn: paymentReturn?.route === 'ap' ? paymentReturn : null,
  };
}

// A Payment -> bank evidence -> JE return marker.  It contains navigation scope
// only and cannot match, clear, reconcile, post, or alter a payment.
export function localPaymentBankEvidenceReturnContext({ acctCode = '', bankTxnId = '', paymentReturn = null } = {}) {
  const account = String(acctCode || '');
  const transaction = String(bankTxnId || '');
  if (!account || !transaction || paymentReturn?.route !== 'ap') return null;
  return {route:'banktx', acctCode:account, bankTxnId:transaction, paymentReturn};
}

export function localPaymentBankEvidenceReturnScopeLabel(context = {}) {
  return `Retained payment bank scope · account ${context.acctCode || 'unselected'} · bank item ${context.bankTxnId || 'unselected'}`;
}
