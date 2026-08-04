import assert from 'node:assert/strict';
import { localCashFlowRegisterTarget } from './src/cash-flow-register-return.js';

assert.deepEqual(localCashFlowRegisterTarget({entityId:2,accountCodes:['111000'],scope:'Operating',fromP:'2026-04',toP:'2026-07',propertyId:'ALL',projectId:'8',loanId:'ALL',dimensionState:'LOCAL_SCOPE_COMPLETE'}),{
  route:'register',accountCode:'111000',fromPeriod:'2026-04',throughPeriod:'2026-07',reportReturn:{route:'gl',tab:'Cash Flow',fromP:'2026-04',toP:'2026-07',entityId:'2',propertyId:'ALL',projectId:'8',loanId:'ALL',cashScope:'Operating',drillAccounts:['111000'],drillLabel:'Cash flow · Operating',state:'LOCAL_REPORT_RETURN_READY'},
});
assert.equal(localCashFlowRegisterTarget({entityId:2,accountCodes:['111000','110100'],scope:'Operating',toP:'2026-07',dimensionState:'LOCAL_SCOPE_COMPLETE'}),null);
assert.equal(localCashFlowRegisterTarget({entityId:2,accountCodes:['111000'],scope:'Restricted',toP:'2026-07',dimensionState:'LOCAL_SCOPE_COMPLETE'}),null);
console.log('cash flow register return: only a single complete local cash scope can open Register');
