import { localReconciliationJournalReturnContext } from './reconciliation-journal-return.js';

// Read-only Reconcile -> report handoff. This carries the visible worksheet
// scope only; it cannot clear, match, sign off, adjust, or post anything.
export function localReconciliationReportReturnContext({ acctCode = '', period = '', statementDate = '', cashScope = 'UNMAPPED', cashAccountCode = '', historyId = null, bankTxnId = null } = {}) {
  const reconciliationReturn = localReconciliationJournalReturnContext({acctCode,historyId,bankTxnId});
  if (!reconciliationReturn) return null;
  return {
    fromP:String(period || ''), toP:String(period || ''), asOfDate:String(statementDate || ''),
    cashScope:String(cashScope || 'UNMAPPED'), drillAccounts:cashAccountCode ? [String(cashAccountCode)] : [],
    drillLabel:`${acctCode} reconciliation cash evidence`, reconciliationReturn,
  };
}
