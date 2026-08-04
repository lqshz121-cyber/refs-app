import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localBankTransactionLifecycle } from './src/bank-transaction-lifecycle.js';

const signed = localBankTransactionLifecycle({bank_txn_id:'BT-1',match_status:'MATCHED',cleared:true}, {accountCode:'BA-003',period:'2026-07',statementDate:'2026-07-31',history:[{id:9,account:'BA-003',period:'2026-07',stmt_date:'2026-07-31',source_txn_ids:['BT-1'],reopen_state:'SIGNED_OFF'}]});
assert.equal(signed.clearingState, 'CLEARED');
assert.equal(signed.reconciliationState, 'SIGNED_OFF');
assert.equal(signed.signedEntry.id, 9);
const unsigned = localBankTransactionLifecycle({bank_txn_id:'BT-2',match_status:'MATCHED',cleared:true}, {accountCode:'BA-003',period:'2026-07',statementDate:'2026-07-31',history:[]});
assert.equal(unsigned.reconciliationState, 'NOT_SIGNED_OFF');
const bankUi = readFileSync(new URL('./src/module-banktx.jsx', import.meta.url), 'utf8');
const reconciliationUi = readFileSync(new URL('./src/module-bankrec.jsx', import.meta.url), 'utf8');
assert.match(bankUi, /const signedHistoryTarget = bankEvidenceDetail\.lifecycle\?\.signedEntry/, 'only a retained signed snapshot enables the history target');
assert.match(bankUi, /Open signed reconciliation history/, 'bank evidence exposes a distinct signed-history drill');
assert.match(bankUi, /Not cleared in a retained signed statement/, 'non-cleared evidence is explicitly unavailable');
assert.match(reconciliationUi, /Back to bank transaction/, 'signed history opened from bank evidence returns to the same bank item');
console.log('bank signed-history return: cleared and signed-off facts stay separate with a retained back path');
