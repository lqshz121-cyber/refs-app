import { filterLocalPaymentHistory, isLocalPaymentHistoryEmpty } from './src/payment-history-listing.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const bills = [
  {bill_id:1, status:'PAID', paid_date:'2026-07-31'},
  {bill_id:2, status:'PAID', paid_date:'2026-06-30'},
  {bill_id:3, status:'APPROVED', bill_date:'2026-07-15'},
];
assert(filterLocalPaymentHistory(bills).map(b=>b.bill_id).join(',') === '1,2', 'all dates includes only local paid evidence');
assert(filterLocalPaymentHistory(bills, {paymentDate:'This month'}).map(b=>b.bill_id).join(',') === '1', 'this month uses payment date');
assert(filterLocalPaymentHistory(bills, {paymentDate:'This month', currentMonth:'2026-06'}).map(b=>b.bill_id).join(',') === '2', 'month reference is explicit');
assert(filterLocalPaymentHistory(bills, {paymentDate:'Unknown'}).length === 0, 'unsupported local date state has no result');
assert(isLocalPaymentHistoryEmpty(bills, {paymentDate:'Unknown'}), 'empty-state helper follows the same local date filter');
assert(!isLocalPaymentHistoryEmpty(bills, {paymentDate:'This month'}), 'empty-state helper keeps local payment evidence visible');
console.log('payment history listing verification passed');
