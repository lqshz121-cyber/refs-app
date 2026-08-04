import assert from 'node:assert/strict';
import { AP_AGING_BUCKETS, localApAgingBucket, localApAgingRows } from './src/ap-aging.js';

const bills = [
  {bill_id:1, status:'APPROVED', due_date:'2026-07-31'},
  {bill_id:2, status:'DRAFT', due_date:'2026-07-01'},
  {bill_id:3, status:'PENDING_APPROVAL', due_date:'2026-05-31'},
  {bill_id:4, status:'PAID', due_date:'2026-01-01'},
];
assert.deepEqual(AP_AGING_BUCKETS, ['Current','1-30','31-60','61-90','90+']);
assert.equal(localApAgingBucket(bills[0]), 'Current');
assert.equal(localApAgingBucket(bills[1]), '1-30');
assert.equal(localApAgingBucket(bills[2]), '61-90');
assert.deepEqual(localApAgingRows(bills).map(row=>row.bill_id), [1,2,3], 'paid evidence is not included in local AP aging');
console.log('AP aging: as-of buckets and open-payable boundary verified');
