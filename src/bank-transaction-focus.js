// Calculates where existing local evidence is displayed. It does not alter a
// bank transaction, matching state, category, or reconciliation state.
export function bankTransactionFocus(rows = [], bankTxnId, pageSize = 50) {
  const hit = rows.find(row => String(row.bank_txn_id) === String(bankTxnId)) || null;
  if (!hit) return { found: false, queue: null, page: 1, transaction: null };
  const queueRows = rows.filter(row => row._state === hit._state);
  const index = queueRows.findIndex(row => String(row.bank_txn_id) === String(bankTxnId));
  return { found: true, queue: hit._state, page: Math.floor(index / pageSize) + 1, transaction: hit };
}
