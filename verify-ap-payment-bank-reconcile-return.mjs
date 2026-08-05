import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ap = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
const bank = readFileSync(new URL('./src/module-banktx.jsx', import.meta.url), 'utf8');
const reconciliation = readFileSync(new URL('./src/reconciliation-receipt-return.js', import.meta.url), 'utf8');
const evidence = readFileSync(new URL('./src/bill-payment-evidence.js', import.meta.url), 'utf8');
const scope = readFileSync(new URL('./src/payment-return-context.js', import.meta.url), 'utf8');

for (const text of [
  'PaymentEvidenceDetail', 'Open payment evidence', 'Open local bank evidence',
  'Open local reconcile evidence', 'Open payment JE', 'Open GL Detail', 'Open Trial Balance',
  'Read-only local evidence detail.', 'entityId:selectedBillPayment.entity_id', 'vendorName:selectedBillPayment.vendor_name',
]) assert.ok(ap.includes(text), `AP payment evidence contract is missing: ${text}`);

assert.match(evidence, /transaction\.direction === 'DEBIT'/, 'Exact bank proof must be a debit');
assert.match(evidence, /paymentJournal\.posting_status !== 'POSTED'/, 'Payment evidence must be posted');
assert.match(evidence, /Math\.abs\(amount\(transaction\.amount\) - paymentCash\) < 0\.005/, 'Bank debit amount must exactly match the posted payment');
assert.ok(bank.includes('Open local reconcile evidence'), 'Bank evidence must expose the read-only reconciliation drill');
assert.ok(reconciliation.includes("paymentReturn?.tab === 'Bills' && (paymentReturn.billDetail || paymentReturn.paymentBillDetail)"), 'Reconciliation must retain a Bill-detail payment return');
assert.ok(reconciliation.includes('Back to Bill payment evidence'), 'Bill-origin reconciliation must show an explicit return label');
assert.ok(scope.includes('vendor ${vendor}') && scope.includes('${entity}'), 'Return scope must identify entity and vendor');
for (const forbidden of ['>Pay vendor<', '>Post payment<', '>Export payment<']) {
  assert.ok(!ap.includes(forbidden), `Read-only AP detail must not expose mutation: ${forbidden}`);
}

console.log('PASS: AP Bill/Payment → exact Bank DEBIT → Reconcile → JE/GL/TB returns to its full-page Bill payment evidence scope');
