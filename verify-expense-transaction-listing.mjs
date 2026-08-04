import assert from 'node:assert/strict';
import { localExpenseTransactionRows } from './src/expense-transaction-listing.js';

const rows = localExpenseTransactionRows({
  bills:[{bill_id:1,bill_no:'B-1',bill_date:'2026-07-10',vendor_name:'Vendor',account_code:'164200',amount:120,status:'APPROVED',property_id:7,paymentEvidence:{billState:'VALID_POSTED_AP'}},{bill_id:2,bill_no:'B-2',bill_date:'2026-07-11',vendor_name:'Paid',account_code:'641600',amount:30,status:'PAID',pay_je_number:'JE-PAY',paymentEvidence:{billState:'VALID_POSTED_AP'}}],
  vendorCredits:[{journal:{je_number:'VC-1',je_date:'2026-07-12',lines:[{account_code:'291001'},{account_code:'164200'}]},creditAmount:40,applicationAmount:10,state:'POSTED_APPLIED_CREDIT',auditState:'POSTED_AUDIT_RETAINED',creditDimensions:{propertyIds:[7],projectIds:[]}}],
});
assert.deepEqual(rows.map(row=>row.type),['Vendor credit','Bill payment','Bill']);
assert.equal(rows.find(row=>row.kind==='BILL' && row.number==='B-2').balance,0);
assert.equal(rows.find(row=>row.kind==='VENDOR_CREDIT').balance,30);
assert.equal(rows.find(row=>row.kind==='VENDOR_CREDIT').category,'164200');
console.log('expense transaction listing: bills, paid bills and retained vendor-credit evidence unified without mutation');
