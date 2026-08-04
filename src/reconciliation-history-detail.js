// Presentation-only history detail: a signed snapshot is immutable evidence.
export function localReconciliationHistoryDetail(entry, bankAccount = null) {
  const sourceTxnIds = [...new Set(entry?.snapshot?.source_txn_ids || entry?.source_txn_ids || [])];
  const sourceTransactions = (bankAccount?.txns || []).filter(transaction => sourceTxnIds.some(id => String(id) === String(transaction.bank_txn_id)));
  return {
    entry: entry || null,
    sourceTxnIds,
    sourceTransactions,
    snapshot: entry?.snapshot || {diff:entry?.diff ?? null,source_txn_ids:sourceTxnIds,statementDate:entry?.stmt_date || null},
    lifecycle: entry?.reopen_state || 'SIGNED_OFF',
    immutable: true,
  };
}
