// Read-only bank-item lifecycle. A match, a clear marker, and reconciliation
// sign-off are independent retained facts; this helper never mutates a bank item.
export function localBankTransactionLifecycle(transaction, {accountCode = null, period = null, statementDate = null, history = []} = {}) {
  const transactionId = transaction?.bank_txn_id;
  const signedEntry = (history || []).find(entry => entry.account === accountCode
    && entry.period === period && entry.stmt_date === statementDate
    && entry.reopen_state !== 'REOPENED'
    && (entry.source_txn_ids || []).some(id => String(id) === String(transactionId))) || null;
  return {
    matchState: transaction?.match_status === 'MATCHED' ? 'MATCHED' : 'PENDING_REVIEW',
    clearingState: transaction?.cleared === true ? 'CLEARED' : 'NOT_CLEARED',
    reconciliationState: signedEntry ? 'SIGNED_OFF' : 'NOT_SIGNED_OFF',
    signedEntry,
  };
}
