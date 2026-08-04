import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
for (const required of [
  '<h2 className="page-h">Reports Center</h2>',
  'Current period revenue',
  'Back to Reports Center',
  "className=\"reports-library report-replacement-view\"",
]) assert.ok(source.includes(required), `missing Reports English/full-page contract: ${required}`);
assert.ok(!source.includes('<h2 className="page-h">鎶'), 'Reports Center heading must be English-only');
for (const required of [
  "const CN={ASSET:'Assets',LIABILITY:'Liabilities',EQUITY:'Equity',REVENUE:'Revenue',EXPENSE:'Expenses'}",
  "'✓ Balanced':'✓ Out of balance'",
  'Memo / dimension member',
  'Reports Center · Workbench',
  'General Ledger · Drilldown',
]) assert.ok(source.includes(required), `missing English reports drill label: ${required}`);
for (const retired of ['璧勪骇 Assets', '鉁?骞宠', '鏍哥畻瀵硅薄', 'Reports Center 璺?Workbench']) {
  assert.ok(!source.includes(retired), `retired localized Reports label remains: ${retired}`);
}
console.log('PASS: Reports English shell and replacement-detail Back contract are present.');
