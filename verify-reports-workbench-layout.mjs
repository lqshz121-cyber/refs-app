import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const reports = read('src/modules-more.jsx');
const styles = read('index.html');

assert.match(reports, /aria-label="Report workbench summary"/, 'Reports summary needs an accessible landmark');
assert.match(reports, /<i>Reports<\/i>\{' '\}<b>\{reportRows\.length\}<\/b>/, 'Reports count must retain visible spacing');
assert.match(reports, /<i>Linked statements<\/i>\{' '\}<b>/, 'Linked statements count must retain visible spacing');
assert.match(reports, /<i>Preview-only<\/i>\{' '\}<b>/, 'Preview-only count must retain visible spacing');
assert.match(styles, /\.report-preview-meta\{display:flex/, 'Reports summary requires a grouped flex layout');
assert.match(styles, /\.report-preview-meta span\{display:flex/, 'Each reports metric requires its own visual container');
assert.match(styles, /@media\(max-width:720px\)\{\.report-workbench-head\{flex-direction:column/, 'Reports summary must stack on narrow screens');
assert.match(styles, /\.report-shelf\{display:flex;align-items:center;gap:8px;flex-wrap:wrap/, 'Reports navigation requires a readable chip layout');
assert.match(styles, /\.qbo-toolgrid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(220px,1fr\)\)/, 'Reports control evidence requires grouped metric cards');
assert.match(styles, /\.qbo-report-centerbar\{display:flex;align-items:center;gap:8px;flex-wrap:wrap/, 'Reports search and actions require a stable toolbar');
console.log('PASS: Reports workbench summary uses readable metric cards and responsive spacing.');
