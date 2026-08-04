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
console.log('PASS: Reports English shell and replacement-detail Back contract are present.');
