// Read-only Reconcile -> JE return scope. It preserves the local reconciliation
// account/snapshot focus only; it never clears, signs off, matches, or posts.
export function localReconciliationJournalReturnContext({ acctCode = '', historyId = null, bankTxnId = null } = {}) {
  const account = String(acctCode || '');
  if (!account) return null;
  return {route:'bankrec', acctCode:account, historyId:historyId == null ? null : historyId, bankTxnId:bankTxnId == null ? null : String(bankTxnId)};
}

export function localReconciliationJournalReturnScopeLabel(context = {}) {
  const snapshot = context.historyId == null ? 'current local worksheet' : `signed snapshot ${context.historyId}`;
  return `Retained reconciliation scope · ${context.acctCode || 'unselected account'} · ${snapshot}`;
}
