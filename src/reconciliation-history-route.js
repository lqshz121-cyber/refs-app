// A history drill can only target a retained local reconciliation snapshot.
// Keep route decoding separate from the worksheet so an unknown URL/context
// cannot manufacture a sign-off record.
export function localReconciliationHistoryRoute(history = [], historyId) {
  if (historyId == null || historyId === '') return null;
  return history.find(entry => String(entry.id) === String(historyId)) || null;
}
