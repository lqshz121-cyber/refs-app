// Local workflow metadata only. It never changes a JE, bank transaction, or
// retained sign-off snapshot.
export function localReconciliationReopenState(history = [], {account, period, statementDate} = {}) {
  const entry = [...history].find(row => row.account === account && row.period === period && row.stmt_date === statementDate) || null;
  if (!entry) return {state:'NO_SIGNOFF', entry:null, snapshot:null, canRequest:false, canReconcile:false};
  const snapshot = entry.snapshot || {diff:entry.diff,source_txn_ids:[...(entry.source_txn_ids || [])],statementDate:entry.stmt_date};
  if (entry.reopen_state === 'REQUESTED') return {state:'REOPEN_REQUESTED',entry,snapshot,canRequest:false,canReconcile:false};
  if (entry.reopen_state === 'REJECTED') return {state:'REOPEN_REJECTED',entry,snapshot,canRequest:true,canReconcile:false};
  if (entry.reopen_state === 'REOPENED') return {state:'REOPENED',entry,snapshot,canRequest:false,canReconcile:true};
  return {state:'SIGNED_OFF',entry,snapshot,canRequest:true,canReconcile:false};
}
