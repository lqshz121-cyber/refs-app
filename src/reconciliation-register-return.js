// A signed reconciliation snapshot may open only its mapped local cash
// register. This is navigation evidence, not a clear/sign-off/adjust action.
export function localReconciliationHistoryRegisterContext({ entityId = '', acctCode = '', cashAccountCode = '', period = '', statementDate = '', historyId = null, sourceTxnIds = [] } = {}) {
  const entity = String(entityId || '');
  const bankAccount = String(acctCode || '');
  const cashAccount = String(cashAccountCode || '');
  if (!entity || !bankAccount || !cashAccount || historyId == null) return null;
  return {
    route:'register', entityId:entity, accountCode:cashAccount, throughPeriod:String(period || ''), statementDate:String(statementDate || ''),
    reconciliationHistoryReturn:{route:'bankrec',acctCode:bankAccount,historyId,statementDate:String(statementDate || ''),sourceTxnIds:[...new Set((sourceTxnIds || []).map(String))]},
  };
}

export function localReconciliationRegisterEvidence(bankEvidence = {}, reconciliationHistoryReturn = null) {
  const sourceIds = new Set(reconciliationHistoryReturn?.sourceTxnIds || []);
  if (!reconciliationHistoryReturn?.route || !sourceIds.size) return {state:'NO_SIGNED_SCOPE', label:'No signed reconciliation snapshot scope'};
  const hits = (bankEvidence.bankTxnIds || []).map(String).filter(id => sourceIds.has(id));
  if (!hits.length) return {state:'OUTSIDE_SIGNED_SCOPE', label:'No bank evidence in this signed snapshot'};
  const cleared = new Set((bankEvidence.clearedBankTxnIds || []).map(String));
  if (hits.every(id => cleared.has(id))) return {state:'CLEARED_SIGNED_OFF', label:'Cleared in retained signed reconciliation snapshot'};
  return {state:'MATCHED_NOT_CLEARED_REVIEW', label:'Matched snapshot evidence is not cleared'};
}
