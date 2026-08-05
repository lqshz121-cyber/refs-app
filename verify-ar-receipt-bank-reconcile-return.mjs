import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ar = readFileSync(new URL('./src/module-ar.jsx', import.meta.url), 'utf8');
const receiptEvidence = readFileSync(new URL('./src/invoice-receipt-evidence.js', import.meta.url), 'utf8');
const reconciliation = readFileSync(new URL('./src/reconciliation-receipt-return.js', import.meta.url), 'utf8');
const journal = readFileSync(new URL('./src/modules-core.jsx', import.meta.url), 'utf8');

for (const text of [
  'function ReceiptDetail',
  'Open receipt detail',
  'Back to customer receipts',
  'Open receipt JE',
  'Open bank credit',
  'Receipt evidence controls',
  'Read-only evidence only.',
  "receiptId:receipt.payment_id",
  "tab:'Receipts'",
]) assert.ok(ar.includes(text), `AR receipt drill is missing: ${text}`);

assert.match(ar, /onRow=\{row=>openReceiptDetail\(row\.payment_id/, 'Receipt rows must replace the list with an explicit full-page drill');
assert.match(ar, /if \(invoice && !navContext\.receiptId && !navContext\.receiptJournal\)/, 'Receipt return context must not reopen the parent invoice detail');
assert.match(ar, /goto\('banktx',\{route:'banktx',[\s\S]*arReturn:receiptEvidenceReturn/, 'Bank credit drill must retain receipt return context');
assert.match(ar, /goto\('je',\{jeNumber:receipt\.payment_journal,arReturn:receiptEvidenceReturn\}/, 'Receipt JE drill must retain receipt return context');
assert.match(receiptEvidence, /direction === 'CREDIT'/, 'Retained bank proof must be a credit');
assert.match(receiptEvidence, /Math\.abs\(amount\(transaction\.amount\) - receiptCash\) < 0\.005/, 'Retained bank proof must match the posted receipt amount exactly');
assert.match(receiptEvidence, /paymentJournal\.posting_status !== 'POSTED'/, 'Receipt evidence must be posted');
assert.ok(reconciliation.includes('Back to customer receipts'), 'Reconciliation must return to the retained receipt scope');
assert.ok(journal.includes('ctx.navContext?.arReturn?.route === \'ar\''), 'Journal evidence must support AR return context');

for (const forbidden of ['Collect payment', 'Allocate payment', 'Post receipt', 'Export receipt']) {
  assert.ok(!ar.includes(forbidden), `Read-only receipt flow must not expose mutation: ${forbidden}`);
}

console.log('PASS: AR receipt → bank credit → reconciliation/JE return contract is full-page and read-only');
