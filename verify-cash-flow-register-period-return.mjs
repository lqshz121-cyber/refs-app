import assert from 'node:assert/strict';
import { localCashFlowRegisterTarget } from './src/cash-flow-register-return.js';

const target = localCashFlowRegisterTarget({entityId:2,accountCodes:['111000'],scope:'Operating',fromP:'2026-04',toP:'2026-07',propertyId:'ALL',projectId:'8',loanId:'ALL',dimensionState:'LOCAL_SCOPE_COMPLETE'});
assert.equal(target.fromPeriod, '2026-04');
assert.equal(target.throughPeriod, '2026-07');
assert.equal(target.reportReturn.fromP, target.fromPeriod);
assert.equal(target.reportReturn.toP, target.throughPeriod);
assert.equal(localCashFlowRegisterTarget({entityId:2,accountCodes:['111000'],scope:'Escrow',fromP:'2026-04',toP:'2026-07',dimensionState:'LOCAL_SCOPE_COMPLETE'}), null, 'mismatched cash scope cannot manufacture a Register route');
console.log('cash flow register period return: opening/activity dates remain identical across Cash Flow and Register');
