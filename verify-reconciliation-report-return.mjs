import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localReconciliationReportReturnContext } from './src/reconciliation-report-return.js';

const context = localReconciliationReportReturnContext({acctCode:'BA-003',period:'2026-07',statementDate:'2026-07-31',cashScope:'Operating',cashAccountCode:'111000',historyId:9,bankTxnId:'BT-42'});
assert.deepEqual(context,{fromP:'2026-07',toP:'2026-07',asOfDate:'2026-07-31',cashScope:'Operating',drillAccounts:['111000'],drillLabel:'BA-003 reconciliation cash evidence',reconciliationReturn:{route:'bankrec',acctCode:'BA-003',historyId:9,bankTxnId:'BT-42'}});
assert.equal(localReconciliationReportReturnContext({}), null);
const reconcileUi = readFileSync(new URL('./src/module-bankrec.jsx', import.meta.url), 'utf8');
assert.match(reconcileUi, /tab:'Trial Balance',\.\.\.historyReportScope/, 'Signed history can preserve its same-statement return context when opening Trial Balance');
console.log('reconciliation report return: worksheet bank, cutoff, cash account, and Back context retained');
