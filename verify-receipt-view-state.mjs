import { RECEIPT_VIEWS, RECEIPT_LOCAL_CLOSE_BOUNDARY, receiptEmptyState, receiptBankBridgeHint } from './src/receipt-view-state.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(RECEIPT_VIEWS.join('|') === 'For review|Reviewed', 'observed receipt views are retained');
assert(receiptEmptyState('For review') === 'Add new receipts to get started', 'review queue uses observed local empty copy');
assert(receiptEmptyState('Reviewed') === 'No reviewed local receipts', 'reviewed queue has distinct empty state');
assert(receiptEmptyState('Unknown', 2) === '2 local receipts in For review', 'unknown state normalizes locally');
assert(RECEIPT_LOCAL_CLOSE_BOUNDARY.excluded.includes('Document upload or email forwarding'), 'external receipt ingestion remains excluded');
assert(/No local receipt evidence/.test(receiptBankBridgeHint('For review')), 'empty receipt state does not imply a bank link');
assert(/1 local reviewed receipt record/.test(receiptBankBridgeHint('Reviewed', 1)), 'retained local receipt evidence may be reviewed before matching');
console.log('receipt view state verification passed');
