import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');

assert.match(ui, /function PaymentEvidenceDetail\(/, 'Payments has a dedicated full-page evidence detail');
assert.match(ui, /Back to Bill payments/, 'Payment detail offers an explicit return to the originating list');
assert.match(ui, /NO_POSTED_PAYMENT_EVIDENCE/, 'Missing posted-payment proof is explicit');
assert.match(ui, /NO_EXACT_LOCAL_BANK_DEBIT/, 'A missing bank debit is not represented as a bank match');
assert.match(ui, /NO_ELIGIBLE_RECONCILIATION_RECORD/, 'A bank debit without signed reconciliation remains explicit');
assert.match(ui, /setSelectedPayment\(r\)/, 'Payment-list rows open the detail in place rather than appending it below the list');
assert.match(ui, /No exact Bank DEBIT/, 'The list preserves the exact-bank-evidence boundary before drilling');

console.log('payment detail empty/return: scoped payment evidence replaces the list and retains explicit bank/reconcile boundaries');
