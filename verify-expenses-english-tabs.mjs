import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
assert.match(source, /<Tabs tabs=\{\['Bills','Payments','AP Aging','Vendors'\]\}/);
assert.match(source, /tab==='Payments'/);
assert.match(source, /tab==='AP Aging'/);
assert.match(source, /tab==='Vendors'/);
assert.match(source, /const localTabFor = value => \(\{Payments:'Payments','AP Aging':'AP Aging',Vendors:'Vendors'\}\)\[value\] \|\| value;/);
assert.doesNotMatch(source, /[\p{Script=Han}]/u);
console.log('expenses English tabs: Bills, Payments, AP Aging, and Vendors use English-only retained local contexts');
