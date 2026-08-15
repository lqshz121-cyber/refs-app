import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const styles=readFileSync('index.html','utf8');
const ap=readFileSync('src/module-ap.jsx','utf8');

assert.match(styles,/@media\(max-width:900px\)\{[\s\S]*?\.expense-filter-evidence\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/,
  'Payables filters must use shrinkable two-column tracks at high zoom/tablet width');
assert.match(styles,/@media\(max-width:900px\)\{[\s\S]*?\.expense-toolbar\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/,
  'the main Payables toolbar must not size itself from the Vendor or date controls');
assert.match(styles,/@media\(max-width:900px\)\{[\s\S]*?\.expense-toolbar>\*\{min-width:0;\}[\s\S]*?\.expense-toolbar select,\.expense-toolbar input\{box-sizing:border-box;min-width:0;width:100%;max-width:100%;\}/,
  'Payables toolbar controls must shrink inside their grid cells instead of overflowing the workspace');
assert.match(styles,/@media\(max-width:600px\)\{[\s\S]*?\.expense-filter-evidence,.expense-toolbar\{grid-template-columns:minmax\(0,1fr\);\}/,
  'phone widths must collapse both Payables filter surfaces to one safe column');
assert.match(ap,/label>Payee <select/, 'the responsive contract covers the actual Payee selector');

console.log('payables-responsive: Payables filters use explicit shrinkable columns at 900px and one column at 600px');
