import assert from 'node:assert/strict';
import { reconciliationBankEvidence, reconciliationHistoryState, reconciliationStatus } from './src/bank-reconciliation.js';

const balanced = { account_code: 'BA-TEST', period: '2026-07', stmt_date: '2026-07-31', stmt_end: 100, gl_book_balance: 100, deposits_in_transit: [], outstanding_checks: [], txns: [] };
assert.equal(reconciliationStatus(balanced).canSign, true, 'balanced account with no pending activity can sign');
assert.equal(reconciliationStatus({ ...balanced, txns: [{ match_status: 'UNMATCHED' }] }).reason, 'UNMATCHED_ACTIVITY', 'pending bank activity blocks sign-off');
assert.equal(reconciliationStatus({ ...balanced, gl_book_balance: 99 }).reason, 'OUT_OF_BALANCE', 'non-zero difference blocks sign-off');
assert.equal(reconciliationStatus(balanced, [{ account: 'BA-TEST', period: '2026-07', stmt_date: '2026-07-31' }]).reason, 'ALREADY_SIGNED', 'same account and statement cannot sign twice');
assert.deepEqual(reconciliationHistoryState([], 'BA-TEST'), {entries:[], count:0, isEmpty:true, emptyLabel:'No local reconciliation sign-offs for BA-TEST yet.'}, 'empty local history is explicit');
assert.equal(reconciliationHistoryState([{account:'BA-TEST'}, {account:'BA-OTHER'}], 'BA-TEST').count, 1, 'history scopes to the selected local account');
assert.equal(reconciliationBankEvidence({ txns: [{ bank_txn_id: 11, match_status: 'MATCHED' }] }, 11).eligible, true, 'only a retained matched bank transaction opens local reconciliation context');
assert.equal(reconciliationBankEvidence({ txns: [{ bank_txn_id: 12, match_status: 'UNMATCHED' }] }, 12).reason, 'UNMATCHED_BANK_TRANSACTION', 'unmatched activity has no reconciliation drill');
assert.equal(reconciliationBankEvidence(null, 11).reason, 'MISSING_BANK_TRANSACTION', 'missing evidence has no reconciliation drill');
console.log('bank reconciliation: balance, unmatched, difference, and duplicate-sign-off gates verified');
