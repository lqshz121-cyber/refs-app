import { filterLocalVendors, localVendorEvidence, localVendorOpenBalance, localVendorWorkflowTarget } from './src/vendor-listing.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const vendors = [{vendor_id: 1, vendor_code: 'V-100', vendor_name: 'Blue Peak'}, {vendor_id: 2, vendor_code: 'V-200', vendor_name: 'Summit General'}];
const bills = [
  {vendor_id: 1, status: 'DRAFT', amount: 10},
  {vendor_id: 1, status: 'APPROVED', amount: 20},
  {vendor_id: 1, status: 'PAID', amount: 30},
  {vendor_id: 1, status: 'VOID', amount: 40},
  {vendor_id: 2, status: 'PENDING_APPROVAL', amount: 50},
];
assert(filterLocalVendors(vendors, 'blue').map(v => v.vendor_id).join(',') === '1', 'name search filters local vendors');
assert(filterLocalVendors(vendors, 'v-200').map(v => v.vendor_id).join(',') === '2', 'code search filters local vendors');
assert(localVendorOpenBalance(bills, 1) === 30, 'open balance excludes paid and void local bills');
assert(localVendorOpenBalance(bills, 2) === 50, 'open balance remains vendor scoped');
assert(JSON.stringify(localVendorWorkflowTarget(2, 'Bills')) === JSON.stringify({route:'ap', context:{route:'ap', tab:'Bills', vendorId:'2'}}), 'vendor bills drill keeps local vendor context');
assert(localVendorWorkflowTarget(null) === null, 'missing vendor cannot create a drill');
const journals = [{je_number:'AP-1', entity_id:2, posting_status:'POSTED', lines:[{account_code:'705002',debit_amount:100},{account_code:'291001',credit_amount:100}]},{je_number:'PAY-1', entity_id:2, posting_status:'POSTED', lines:[{account_code:'291001',debit_amount:100},{account_code:'111000',credit_amount:100}]}];
const vendorProof = localVendorEvidence({vendor_id:1,is_1099:true}, [{vendor_id:1,status:'APPROVED',amount:100,account_code:'705002',je_number:'AP-1'}], journals, []);
assert(vendorProof.state === 'ENTITY_SCOPED_LOCAL_VENDOR', 'posted AP proof retains one entity');
assert(vendorProof.open_balance === 100, 'only posted AP proof reaches the vendor balance');
assert(vendorProof.taxState === '1099_SOURCE_OR_TAX_EVIDENCE_MISSING', '1099 needs retained source/tax evidence');
console.log('vendor listing verification passed');
