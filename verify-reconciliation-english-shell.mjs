import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-bankrec.jsx', import.meta.url), 'utf8');
for (const required of [
  'Local reconciliation · immutable snapshot',
  'Reconciliation period',
  'Retained adjustments (fees / interest)',
  'Unrecorded adjustments (review below)',
  "'✓ Ready to sign off'",
  'Adjusted Bank must equal Adjusted Book',
  'Sign-off unavailable',
]) assert.ok(source.includes(required), `missing reconciliation English/read-only label: ${required}`);
assert.doesNotMatch(source, /[\p{Script=Han}]/u, 'reconciliation source must not retain CJK visible labels');
assert.ok(!source.includes('actions.bankRecord'), 'reconciliation cannot expose posting action');
assert.ok(!source.includes('actions.bankSuspense'), 'reconciliation cannot expose suspense posting action');
assert.ok(!source.includes('actions.bankSignoff'), 'reconciliation cannot expose sign-off posting action');
console.log('reconciliation English/read-only shell verification passed');
