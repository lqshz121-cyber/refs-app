import assert from 'node:assert/strict';
import { localBalanceSheetRegisterTarget } from './src/balance-sheet-register-return.js';

assert.deepEqual(localBalanceSheetRegisterTarget({entityId:'1',accountCode:'111000',accountName:'Operating Cash',fromP:'2026-01',toP:'2026-07',propertyId:'12',projectId:'ALL',loanId:'9',dimensionState:'LOCAL_SCOPE_COMPLETE'}),{
  route:'register',accountCode:'111000',fromPeriod:'2026-01',throughPeriod:'2026-07',reportReturn:{route:'gl',tab:'Balance Sheet',fromP:'2026-01',toP:'2026-07',entityId:'1',propertyId:'12',projectId:'ALL',loanId:'9',cashScope:'Operating',drillAccounts:['111000'],drillLabel:'111000 Operating Cash',state:'LOCAL_REPORT_RETURN_READY'},
});
assert.equal(localBalanceSheetRegisterTarget({entityId:'1',accountCode:'120200',toP:'2026-07',dimensionState:'LOCAL_SCOPE_COMPLETE'}),null);
assert.equal(localBalanceSheetRegisterTarget({entityId:'1',accountCode:'111000',toP:'2026-07',dimensionState:'REVIEW_REQUIRED'}),null);
console.log('balance sheet register return: only complete-scope mapped cash rows retain BS scope');
