import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reportsUi = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
assert.match(reportsUi, /Customize unavailable<\/button>/, 'Report drill must not imply QBO report customization is available');
assert.match(reportsUi, /QBO-style report customization is outside the retained local evidence scope/, 'Disabled state explains the business-fit boundary');
assert.doesNotMatch(reportsUi, /notify\('Drill report customized'\)/, 'No fake report-customization outcome remains');
console.log('report drill boundaries: customization remains explicitly unavailable');
