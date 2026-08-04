import assert from 'node:assert/strict';
import { localReconciliationHistoryRegisterContext, localReconciliationRegisterEvidence } from './src/reconciliation-register-return.js';

const context = localReconciliationHistoryRegisterContext({entityId:'E-1',acctCode:'BA-003',cashAccountCode:'111000',period:'2026-07',statementDate:'2026-07-31',historyId:9,sourceTxnIds:['BT-1','BT-1','BT-2']});
assert.deepEqual(context,{route:'register',entityId:'E-1',accountCode:'111000',throughPeriod:'2026-07',reconciliationHistoryReturn:{route:'bankrec',acctCode:'BA-003',historyId:9,statementDate:'2026-07-31',sourceTxnIds:['BT-1','BT-2']}});
assert.equal(localReconciliationHistoryRegisterContext({acctCode:'BA-003',cashAccountCode:'111000',historyId:9}), null);
assert.deepEqual(localReconciliationRegisterEvidence({bankTxnIds:['BT-1'],clearedBankTxnIds:['BT-1']},context.reconciliationHistoryReturn),{state:'CLEARED_SIGNED_OFF',label:'Cleared in retained signed reconciliation snapshot'});
assert.equal(localReconciliationRegisterEvidence({bankTxnIds:['BT-2'],clearedBankTxnIds:[]},context.reconciliationHistoryReturn).state,'MATCHED_NOT_CLEARED_REVIEW');
assert.equal(localReconciliationRegisterEvidence({bankTxnIds:['BT-3']},context.reconciliationHistoryReturn).state,'OUTSIDE_SIGNED_SCOPE');
console.log('reconciliation register return: signed snapshot and cleared evidence scope retained');
