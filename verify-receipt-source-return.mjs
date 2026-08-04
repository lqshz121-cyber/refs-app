import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const receipts = readFileSync(new URL('./src/module-receipts.jsx', import.meta.url), 'utf8');
const sources = readFileSync(new URL('./src/module-sourcedocs.jsx', import.meta.url), 'utf8');

assert.match(receipts, /docId:receipt\.source_ref,jeNumber:receipt\.journal_number,receiptReturn/, 'Receipt source drill retains its exact Receipts detail return');
assert.match(sources, /navContext\?\.receiptReturn\?\.route==='receipts'/, 'Source Documents recognizes a Receipt-detail origin');
assert.match(sources, /goto\('receipts',navContext\.receiptReturn\).*Back to Receipt evidence/, 'Source Documents visibly returns to the exact Receipt evidence detail');
console.log('receipt source return: source-document drill preserves the receipt evidence detail and its list scope');
