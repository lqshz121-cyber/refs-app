import assert from 'node:assert/strict';
import { localReconciliationReopenState } from './src/reconciliation-reopen-evidence.js';
const base={id:1,account:'BA-1',period:'2026-07',stmt_date:'2026-07-31',diff:0,source_txn_ids:[10],snapshot:{diff:0,source_txn_ids:[10],statementDate:'2026-07-31'}};
const scope={account:'BA-1',period:'2026-07',statementDate:'2026-07-31'};
assert.equal(localReconciliationReopenState([base],scope).state,'SIGNED_OFF');
assert.equal(localReconciliationReopenState([{...base,reopen_state:'REQUESTED'}],scope).canReconcile,false);
assert.equal(localReconciliationReopenState([{...base,reopen_state:'REOPENED'}],scope).canReconcile,true);
assert.equal(localReconciliationReopenState([],scope).state,'NO_SIGNOFF');
console.log('reconciliation reopen evidence: signed snapshot and request/reopen states verified');
