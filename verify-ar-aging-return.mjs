import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const arUi = readFileSync(new URL('./src/module-ar.jsx', import.meta.url), 'utf8');
const journalUi = readFileSync(new URL('./src/modules-core.jsx', import.meta.url), 'utf8');
assert.match(arUi, /onRow=\{row=>openInvoiceDetail\(row\.inv_id,\{tab:'AR Aging',asOfDate\}\)\}/, 'AR Aging rows retain their report origin before opening Invoice detail');
assert.match(arUi, /jeNumber:r\.journal\.je_number,arReturn:\{route:'ar',tab:'AR Aging',asOfDate\}/, 'AR control-difference JE retains the AR Aging as-of scope');
assert.match(journalUi, /const returnToArAging = ctx\.navContext\?\.arReturn\?\.route === 'ar' && ctx\.navContext\.arReturn\.tab === 'AR Aging'/, 'Journal recognizes an AR Aging origin');
assert.match(journalUi, /Back to AR Aging/, 'Journal visibly returns to AR Aging rather than a generic list');
console.log('AR aging return: invoice and control JE retain the focused aging scope');
