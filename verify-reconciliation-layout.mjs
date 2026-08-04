import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const reconciliation = read('src/module-bankrec.jsx');
const styles = read('index.html');

assert.match(reconciliation, /aria-label="Local reconciliation worksheet scope"/, 'Reconciliation needs a named worksheet landmark');
assert.match(reconciliation, /<i>Statement beginning \/ ending<\/i><b>/, 'Statement amounts need an explicit metric label');
assert.match(reconciliation, /<i>Adjusted bank \/ book \/ difference<\/i><b>/, 'Adjustment totals need an explicit metric label');
assert.match(reconciliation, /aria-label="Reconciliation statement bridge"/, 'Reconciliation needs a named statement bridge');
assert.match(styles, /\.qbo-toolgrid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(220px,1fr\)\)/, 'Reconciliation metrics need card layout');
assert.match(styles, /\.qbo-toolgrid>span,.qbo-toolgrid>div\{display:flex;flex-direction:column;gap:5px/, 'Reconciliation metrics need label/value separation');
assert.match(styles, /\.qbo-report-promo\{display:flex;flex-direction:column;gap:7px/, 'Reconciliation introduction needs spaced vertical structure');
console.log('PASS: Reconciliation introduction, worksheet, and bridge retain readable labelled metric cards.');
