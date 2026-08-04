import assert from 'node:assert/strict';
import { localApAgingReturnContext, localApAgingReturnScopeLabel } from './src/ap-aging-return-context.js';

const context = localApAgingReturnContext({vendorId:7,asOfDate:'2026-07-31',agingBucket:'31-60'});
assert.deepEqual(context,{route:'ap',tab:'AP Aging',vendorId:'7',asOfDate:'2026-07-31',agingBucket:'31-60'});
assert.match(localApAgingReturnScopeLabel(context), /vendor 7.*31-60.*2026-07-31/);
console.log('AP aging return context: vendor, cutoff, and bucket remain visible');
