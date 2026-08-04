// Preserve the source workflow when a retained bank item replaces the list.
// This is navigation metadata only; it must never infer a match or alter a bank item.
export function localBankTransactionDetailBackTarget(navContext = {}, focus = {}) {
  if (navContext.arReturn?.route === 'ar') {
    return {route:'ar', context:navContext.arReturn, label:navContext.arReturn.invoiceId ? 'Back to Invoice detail' : 'Back to customer receipts'};
  }
  if (navContext.receiptReturn?.route === 'receipts') {
    return {route:'receipts', context:navContext.receiptReturn, label:'Back to Receipt evidence'};
  }
  if (navContext.reconciliationReturn?.route === 'bankrec') {
    return {route:'bankrec', context:navContext.reconciliationReturn, label:'Back to reconciliation history'};
  }
  if (navContext.reportReturn?.route === 'gl') {
    return {route:'gl', context:navContext.reportReturn, label:`Back to ${navContext.reportReturn.tab || 'report'}`};
  }
  return {
    route:'banktx',
    context:{route:'banktx',acctCode:navContext.acctCode,queue:focus.queue || navContext.queue || 'Review',query:navContext.query || '',dateRange:navContext.dateRange || 'All dates',type:navContext.type || 'All transactions',page:focus.page || 1},
    label:'Back to bank transactions',
  };
}

// Read-only bank-evidence -> JE return scope. It retains the same bank item and
// any higher-level Receipt/Reconcile origin without matching or changing it.
export function localBankTransactionJournalReturnContext({acctCode = '', bankTxnId = '', origin = {}} = {}) {
  const account = String(acctCode || '');
  const transaction = String(bankTxnId || '');
  if (!account || !transaction) return null;
  return {
    route:'banktx', acctCode:account, bankTxnId:transaction,
    receiptReturn:origin.receiptReturn?.route === 'receipts' ? origin.receiptReturn : null,
    reconciliationReturn:origin.reconciliationReturn?.route === 'bankrec' ? origin.reconciliationReturn : null,
  };
}

export function localBankTransactionJournalReturnScopeLabel(context = {}) {
  return `Retained bank scope · account ${context.acctCode || 'unselected'} · bank item ${context.bankTxnId || 'unselected'}`;
}
