import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sourceUi = readFileSync(new URL('./src/module-sourcedocs.jsx', import.meta.url), 'utf8');
const journalUi = readFileSync(new URL('./src/modules-core.jsx', import.meta.url), 'utf8');

assert.match(sourceUi, /const selectedSourceReturn = selectedDoc \? \{[\s\S]*?route:'sourcedocs', docId:selectedDoc\.id,[\s\S]*?expenseReturn:navContext\?\.expenseReturn/, 'A focused source document retains its upstream AP/Receipt origin');
assert.match(sourceUi, /reportReturn:navContext\?\.reportReturn\?\.route === 'gl' \? navContext\.reportReturn : null/, 'A report-origin source document retains its complete GL/TB return scope');
assert.match(sourceUi, /jeNumber:selectedJE\.je_number,sourceDocumentReturn:selectedSourceReturn/, 'Source-document JE drill retains the selected source context');
assert.match(sourceUi, /goto\('je', \{jeNumber,sourceDocumentReturn:\{route:'sourcedocs',docId:r\.id\}\}\)/, 'Source-register row JE drill retains its selected document context');
assert.match(journalUi, /returnToSourceDocument = ctx\.navContext\?\.sourceDocumentReturn\?\.route === 'sourcedocs'/, 'Journal Entry recognizes a source-document origin');
assert.match(journalUi, /Back to Source Document/, 'Journal Entry visibly returns to the original source document');
assert.match(journalUi, /returnToSourceDocument\.reportReturn\?\.tab/, 'Journal Entry visibly identifies a retained report origin');
assert.match(journalUi, /expenseReturn:returnToApAging \|\| returnToVendorCredit \|\| returnToBill \? ctx\.navContext\.expenseReturn : null/, 'Journal-to-source drill retains the original AP evidence scope');
assert.match(sourceUi, /navContext\?\.arReturn\?\.route==='ar' && navContext\.arReturn\.invoiceId.*Back to Invoice detail/, 'Source Documents recognizes and visibly returns an invoice-detail origin');
console.log('source document JE return: source-to-JE drill preserves the focused evidence and upstream workflow context');
