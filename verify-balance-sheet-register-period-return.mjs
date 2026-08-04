import assert from 'node:assert/strict';
import { localBalanceSheetRegisterTarget } from './src/balance-sheet-register-return.js';

const target = localBalanceSheetRegisterTarget({entityId:2,accountCode:'111000',accountName:'Operating Cash',fromP:'2026-01',toP:'2026-07',propertyId:'P-1',projectId:'ALL',loanId:'L-1',dimensionState:'LOCAL_SCOPE_COMPLETE'});
assert.equal(target.fromPeriod, '2026-01');
assert.equal(target.throughPeriod, '2026-07');
assert.equal(target.reportReturn.fromP, target.fromPeriod);
assert.equal(target.reportReturn.toP, target.throughPeriod);
assert.equal(localBalanceSheetRegisterTarget({entityId:2,accountCode:'164100',fromP:'2026-01',toP:'2026-07',dimensionState:'LOCAL_SCOPE_COMPLETE'}), null, 'CWIP remains GL-only, never a cash Register surrogate');
console.log('balance sheet register period return: BS as-of range remains identical in the local Register');
