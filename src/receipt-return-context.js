// Read-only return context for a retained receipt evidence drill. It carries
// list selection only; it never reviews, uploads, posts, matches, or edits one.
export function localReceiptJournalReturnContext({ receiptId = '', view = 'For review', query = '' } = {}) {
  const id = String(receiptId || '');
  if (!id) return null;
  return {route:'receipts', receiptId:id, view:view === 'Reviewed' ? 'Reviewed' : 'For review', query:String(query || '')};
}

export function localReceiptReturnScopeLabel(context = {}) {
  return `Retained receipt scope · ${context.receiptId || 'unselected receipt'} · ${context.view || 'For review'}`;
}
