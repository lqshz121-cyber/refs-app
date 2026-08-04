import assert from 'node:assert/strict';
import { localBankTransactionLifecycle } from './src/bank-transaction-lifecycle.js';

const base = {bank_txn_id:7,match_status:'MATCHED'};
const unverified = localBankTransactionLifecycle(base,{accountCode:'BA-1',period:'2026-07',statementDate:'2026-07-31'});
assert.deepEqual(unverified,{matchState:'MATCHED',clearingState:'NOT_CLEARED',reconciliationState:'NOT_SIGNED_OFF',signedEntry:null});
const signed = localBankTransactionLifecycle({...base,cleared:true},{accountCode:'BA-1',period:'2026-07',statementDate:'2026-07-31',history:[{account:'BA-1',period:'2026-07',stmt_date:'2026-07-31',source_txn_ids:[7]}]});
assert.equal(signed.clearingState,'CLEARED');
assert.equal(signed.reconciliationState,'SIGNED_OFF');
assert.equal(localBankTransactionLifecycle({bank_txn_id:8,match_status:'UNMATCHED'}).matchState,'PENDING_REVIEW');
console.log('bank transaction lifecycle: match, clear, and sign-off facts remain independent');
