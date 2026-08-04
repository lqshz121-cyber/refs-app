import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');

assert.match(ui, /onOpenPayment=\{\(\)=>setSelectedBillPaymentId\(bill\.bill_id\)\}/, 'Bill Detail can replace itself with its payment detail');
assert.match(ui, /Open payment detail/, 'Bill Detail visibly offers the Payment Detail drill');
assert.match(ui, /paymentReturn=\{\{route:'ap',tab:'Bills',billId:selectedBillPayment\.bill_id,billDetail:true\}\}/, 'Bill-origin Payment Detail retains a Bill return scope');
assert.match(ui, /backLabel="Back to Bill"/, 'Bill-origin Payment Detail has an explicit direct back action');
assert.match(ui, /paymentBillDetail:true/, 'Payment → Bank/JE return can reconstruct Bill-origin detail state');
assert.match(ui, /if \(matchedBill && navContext\.paymentBillDetail\)/, 'A retained Bank/JE return restores Payment Detail over the original Bill');

console.log('bill payment-detail return: Bill → Payment Detail keeps a full-page Bill return chain without changing payment evidence');
