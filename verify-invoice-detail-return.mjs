import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const arUi = readFileSync(new URL('./src/module-ar.jsx', import.meta.url), 'utf8');

assert.match(arUi, /const openInvoiceDetail = \(invoiceId, returnScope = \{tab,asOfDate\}\)/, 'Invoice drill captures its return scope before rendering detail');
assert.match(arUi, /openInvoiceDetail\(row\.inv_id, \{tab:'Invoices',asOfDate\}\)/, 'Invoice-list drill retains Invoices and as-of context');
assert.match(arUi, /openInvoiceDetail\(row\.invoice_id, \{tab:'Receipts',receiptView,asOfDate\}\)/, 'Receipt drill retains Receipts, its active filter, and as-of context');
assert.match(arUi, /const retainedScope = navContext\.invoiceReturn \|\| \{tab:navContext\.tab \|\| 'Invoices',receiptView:navContext\.receiptView \|\| receiptView,asOfDate:navContext\.asOfDate \|\| asOfDate\}/, 'Returned invoice evidence restores an explicit retained scope, including the Receipts filter');
assert.match(arUi, /Back to AR Aging/, 'Invoice detail has a dedicated Aging back label when that scope is supplied');
assert.match(arUi, /setReceiptView\(restore\.receiptView\)/, 'Invoice Back restores the retained Receipts filter');

console.log('invoice detail return: local invoice and receipt scopes are explicit before full-page detail opens');
