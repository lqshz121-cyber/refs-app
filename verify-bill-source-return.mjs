import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apUi = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
const sources = readFileSync(new URL('./src/module-sourcedocs.jsx', import.meta.url), 'utf8');

assert.match(apUi, /sourceSystem:trace\.apJournal\.source_system,expenseReturn:\{route:'ap',tab:'Bills',billId:bill\.bill_id\}/, 'Bill source drill retains the exact Bill detail origin');
assert.match(sources, /navContext\?\.expenseReturn\?\.route==='ap'.*Back to AP Aging/, 'Source Documents recognizes Bill and AP Aging origins');
assert.match(sources, /goto\('ap',navContext\.expenseReturn\).*Back to Bill/, 'Source Documents visibly returns to the exact Bill detail');
console.log('bill source return: source-document drill preserves the originating full-page Bill detail');
