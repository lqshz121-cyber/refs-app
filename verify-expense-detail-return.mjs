import assert from 'node:assert/strict';
import { localExpenseDetailReturnScope } from './src/expense-detail-return.js';

const scope = localExpenseDetailReturnScope({tab:'AP Aging',query:'cedar',statusFilter:'APPROVED',transactionType:'BILLS',dateRange:'THIS_MONTH',fromDate:'2026-07-01',toDate:'2026-07-31',vendorId:'v-1',categoryCode:'161000',billQueueView:'Unpaid'});
assert.deepEqual(scope,{tab:'AP Aging',query:'cedar',statusFilter:'APPROVED',transactionType:'BILLS',dateRange:'THIS_MONTH',fromDate:'2026-07-01',toDate:'2026-07-31',vendorId:'v-1',categoryCode:'161000',billQueueView:'Unpaid'});
assert.equal(Object.isFrozen(scope),true);
assert.equal(localExpenseDetailReturnScope({}).tab,'Bills');
console.log('expense detail return: tab and filter scope retained without mutation');
