import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
for (const required of [
  'const RETAINED_REPORT_NAMES = new Set([',
  "'Trial Balance', 'General Ledger', 'Balance Sheet', 'Income Statement'",
  "'AP Aging',",
  "'Accounts receivable aging summary', 'Reconciliation History'",
  'reports.filter(([name])=>RETAINED_REPORT_NAMES.has(name))',
  'Retained report workbench',
  'POSTED local evidence · scoped drill and return',
]) assert.ok(source.includes(required), `missing retained Reports scope: ${required}`);
assert.ok(!source.includes('Construction & WBS</button><button type="button" className={`report-shelf-chip ${category===\'All reports\''), 'WBS category must not render in the retained Reports shell');
console.log('PASS: Reports catalog is limited to the retained close workflows.');
