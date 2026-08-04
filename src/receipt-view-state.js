export const RECEIPT_VIEWS = ['For review', 'Reviewed'];

export const RECEIPT_LOCAL_CLOSE_BOUNDARY = Object.freeze({
  included: Object.freeze(['Review queue visibility', 'Receipt evidence hint for existing bank-match work']),
  excluded: Object.freeze(['Document upload or email forwarding', 'Autofill or bill/expense conversion', 'External storage and OCR connections']),
});

export function receiptEmptyState(view, total = 0) {
  const activeView = RECEIPT_VIEWS.includes(view) ? view : 'For review';
  const count = Math.max(0, Number(total) || 0);
  if (count) return `${count} local receipt${count === 1 ? '' : 's'} in ${activeView}`;
  return activeView === 'Reviewed' ? 'No reviewed local receipts' : 'Add new receipts to get started';
}

export function receiptBankBridgeHint(view, total = 0) {
  const activeView = RECEIPT_VIEWS.includes(view) ? view : 'For review';
  const count = Math.max(0, Number(total) || 0);
  if (count) return `${count} local ${activeView.toLowerCase()} receipt record${count === 1 ? '' : 's'} can be reviewed before an existing bank match.`;
  return 'No local receipt evidence is available to link; use bank matching only after a retained local receipt or posted source record exists.';
}
