import assert from 'node:assert/strict';
import { filterExpenseEvidence, normalizeExpenseColumnVisibility } from './src/expense-listing.js';

const bills = [
  { bill_no: 'B-1', vendor_id: 1, vendor_name: 'Alpha', invoice_no: 'A-1', bill_date: '2026-07-01', account_code: '641600', status: 'APPROVED' },
  { bill_no: 'B-2', vendor_id: 2, vendor_name: 'Bravo', invoice_no: 'B-2', bill_date: '2026-07-15', account_code: '164200', status: 'PAID', pay_je_number: 'JE-PAY-2' },
  { bill_no: 'B-3', vendor_id: 1, vendor_name: 'Legacy', invoice_no: 'L-3', bill_date: '2025-01-01', account_code: '641600', status: 'PAID', pay_je_number: 'JE-PAY-3' },
];
assert.deepEqual(filterExpenseEvidence(bills, { transactionType: 'BILLS', dateRange: 'ALL' }).map(x => x.bill_no), ['B-1'], 'Bills view excludes local payment evidence');
assert.deepEqual(filterExpenseEvidence(bills, { transactionType: 'BILL_PAYMENTS', dateRange: 'LAST_12_MONTHS' }).map(x => x.bill_no), ['B-2'], 'payment and date filters compose');
assert.deepEqual(filterExpenseEvidence(bills, { status: 'APPROVED', query: 'alpha' }).map(x => x.bill_no), ['B-1'], 'status and search filters compose');
assert.deepEqual(filterExpenseEvidence(bills, { fromDate: '2026-07-10', toDate: '2026-07-20', vendorId: '2', categoryCode: '164200' }).map(x => x.bill_no), ['B-2'], 'custom date, payee, and category filters compose');
assert.deepEqual(normalizeExpenseColumnVisibility({ DATE:false, TOTAL:false, SOURCE:true }), { DATE:false, TYPE:true, NUMBER:true, PAYEE:true, CATEGORY:true, DUE_DATE:false, TOTAL:false, BILL_APPROVAL:true, LOCAL_PROOF:true }, 'only local evidence-backed columns are configurable');
console.log('expense listing: local bill/payment type, date, status, and search gates verified');
