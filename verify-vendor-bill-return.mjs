import fs from 'node:fs';

const source = fs.readFileSync('./src/module-ap.jsx', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(source.includes('function VendorWorkspace({bills, journals, bankTransactions, initialVendorId, onCreateBill, onOpenJournal, onOpenBill, onOpenVendor})'), 'Vendor workspace accepts a retained vendor return target');
assert(source.includes("onClick={()=>onOpenBill(row.bill.bill_id,selectedVendor.vendor_id)}"), 'Vendor evidence row opens its retained Bill detail');
assert(source.includes("ctx.goto('ap',{route:'ap',tab:'Vendors',vendorEvidenceId})"), 'Bill Back restores the exact Vendor evidence page');
assert(source.includes("vendorReturnId ? 'Back to Vendor evidence' : 'Back to Expenses'"), 'Bill detail exposes an unambiguous Vendor Back action');
assert(source.includes("initialVendorId={navContext?.vendorEvidenceId}"), 'Vendor evidence route rehydrates the selected vendor');

console.log('vendor bill return verification passed');
