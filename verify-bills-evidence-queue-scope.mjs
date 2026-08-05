import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterLocalBillQueue, LOCAL_BILL_QUEUE_VIEWS } from './src/bill-queue-view.js';

const ap = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
const returnScope = readFileSync(new URL('./src/expense-detail-return.js', import.meta.url), 'utf8');

const bills = [
  {bill_id:'review', status:'PENDING_APPROVAL', paymentEvidence:{}},
  {bill_id:'draft', status:'DRAFT', paymentEvidence:{}},
  {bill_id:'unpaid', status:'APPROVED', paymentEvidence:{billState:'VALID_POSTED_AP'}},
  {bill_id:'paid', status:'PAID', paymentEvidence:{billState:'VALID_POSTED_AP', paymentState:'VALID_POSTED_PAYMENT'}},
  {bill_id:'unproven-paid', status:'PAID', paymentEvidence:{billState:'VALID_POSTED_AP'}},
];

assert.deepEqual(LOCAL_BILL_QUEUE_VIEWS, ['For review', 'Unpaid', 'Paid'], 'Only the observed, locally provable Bill queues may be active.');
assert.deepEqual(filterLocalBillQueue(bills, 'For review').map(bill => bill.bill_id), ['review']);
assert.deepEqual(filterLocalBillQueue(bills, 'Unpaid').map(bill => bill.bill_id), ['unpaid']);
assert.deepEqual(filterLocalBillQueue(bills, 'Paid').map(bill => bill.bill_id), ['paid']);
assert.deepEqual(filterLocalBillQueue(bills, 'Recurring'), [], 'Recurring schedules are reference-only and unavailable.');

assert.match(ap, /Recurring unavailable/, 'Recurring must be explicitly unavailable instead of simulating a schedule.');
assert.doesNotMatch(ap, /\['All', \.\.\.LOCAL_BILL_QUEUE_VIEWS\]/, 'The ambiguous All Bill queue must not be rendered.');
assert.match(ap, /billReturnScope=\{detailReturnScope \|\| localExpenseDetailReturnScope/, 'Bill details must retain the originating queue scope.');
assert.match(ap, /const evidenceReturnContext = \{\.\.\.\(billReturnScope \|\| \{\}\), \.\.\.vendorReturnContext\}/, 'JE/source drills must carry Bill queue scope.');
assert.match(ap, /navContext\.billQueueView/, 'Returned Bills drills must restore queue scope.');
assert.match(ap, /navContext\.vendorId != null && !navContext\.billQueueView/, 'A deep Bill return must not let its vendor filter overwrite the restored queue scope.');
assert.match(returnScope, /billQueueView:scope\.billQueueView \|\| 'For review'/, 'The default return queue must be evidence-first.');
assert.doesNotMatch(ap, /Pay bills|Add bill|Print|Export|Customize|Approve and create AP journal|actions\.approveBill/, 'Bills evidence UI must not expose local payment, creation, export, customization, or approval mutation.');

console.log('PASS: Bills uses only evidence-proven For review/Unpaid/Paid queues; Recurring is unavailable and Bill → JE/source return scope is retained.');
