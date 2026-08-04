import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
assert.match(source, /<Tabs tabs=\{\['Bills','Payments','AP Aging','Vendors'\]\}/);
assert.match(source, /tab==='Payments'/);
assert.match(source, /tab==='AP Aging'/);
assert.match(source, /tab==='Vendors'/);
assert.match(source, /'浠樻 Payments':'Payments'/);
assert.match(source, /'璐﹂緞 Aging':'AP Aging'/);
assert.match(source, /'渚涘簲鍟\?Vendors':'Vendors'/);
console.log('expenses English tabs: legacy tab contexts normalize to Bills, Payments, AP Aging, and Vendors');
