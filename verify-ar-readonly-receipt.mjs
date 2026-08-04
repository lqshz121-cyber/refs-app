import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-ar.jsx', import.meta.url), 'utf8');
assert.ok(source.includes("{h:'Receipt evidence'"), 'invoice list must identify the receipt-evidence column');
assert.ok(source.includes('Receipt recording is unavailable here; review retained receipt or bank evidence.'), 'receipt action must state its read-only boundary');
assert.ok(source.includes('Receipt unavailable'), 'open invoices must not present an executable receipt action');
assert.ok(!source.includes('actions.receivePayment'), 'invoice list must not auto-record a receipt');
assert.match(source, /if \(selectedInvoice\) return <InvoiceDetail/, 'invoice drill must replace the AR workspace');
assert.match(source, /Back to AR Aging/, 'invoice detail must retain the Aging return path');
console.log('AR receipt shell: read-only receipt boundary and full-page invoice return verified');
