import assert from 'node:assert/strict';
import { localReconciliationJournalReturnContext, localReconciliationJournalReturnScopeLabel } from './src/reconciliation-journal-return.js';

assert.deepEqual(localReconciliationJournalReturnContext({acctCode:'BA-003',historyId:9,bankTxnId:'BT-42'}), {route:'bankrec',acctCode:'BA-003',historyId:9,bankTxnId:'BT-42'});
assert.deepEqual(localReconciliationJournalReturnContext({acctCode:'BA-001'}), {route:'bankrec',acctCode:'BA-001',historyId:null,bankTxnId:null});
assert.equal(localReconciliationJournalReturnContext({}), null);
assert.match(localReconciliationJournalReturnScopeLabel({acctCode:'BA-003',historyId:9}), /BA-003.*9/);
console.log('reconciliation journal return: account and signed-snapshot scope retained');
