import { LOCAL_BILL_QUEUE_VIEWS, filterLocalBillQueue } from './src/bill-queue-view.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const bills = [
  {bill_id: 1, status: 'DRAFT'},
  {bill_id: 2, status: 'PENDING_APPROVAL'},
  {bill_id: 3, status: 'APPROVED'},
  {bill_id: 4, status: 'PAID'},
  {bill_id: 5, status: 'VOID'},
];
assert(LOCAL_BILL_QUEUE_VIEWS.join(',') === 'For review,Unpaid,Paid', 'only locally supported observed queue labels are interactive');
assert(filterLocalBillQueue(bills, 'For review').map(b => b.bill_id).join(',') === '2', 'review queue maps only local pending approval evidence');
assert(filterLocalBillQueue(bills, 'Unpaid').map(b => b.bill_id).join(',') === '1,3', 'unpaid queue maps local draft and approved evidence');
assert(filterLocalBillQueue(bills, 'Paid').map(b => b.bill_id).join(',') === '4', 'paid queue maps only local paid evidence');
assert(filterLocalBillQueue(bills, 'Unknown').length === 5, 'unknown queue view preserves the existing set');
console.log('bill queue view verification passed');
