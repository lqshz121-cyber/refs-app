import assert from 'node:assert/strict';
import { localReconciliationHistoryDetail } from './src/reconciliation-history-detail.js';

const entry = {id:1,account:'BA-1',period:'2026-07',stmt_date:'2026-07-31',diff:0,source_txn_ids:[7],reopen_state:'SIGNED_OFF'};
const detail = localReconciliationHistoryDetail(entry,{txns:[{bank_txn_id:7,match_status:'MATCHED'},{bank_txn_id:8,match_status:'UNMATCHED'}]});
assert.deepEqual(detail.sourceTxnIds,[7]);
assert.equal(detail.sourceTransactions.length,1);
assert.equal(detail.snapshot.statementDate,'2026-07-31');
assert.equal(detail.immutable,true);
assert.equal(localReconciliationHistoryDetail({...entry,reopen_state:'REQUESTED'}).lifecycle,'REQUESTED');
console.log('reconciliation history detail: immutable snapshot and retained bank-item scope verified');
