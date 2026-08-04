import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-bankrec.jsx', import.meta.url), 'utf8');
for (const required of [
  'Statement-level reconciliation bridge',
  'Book balance + retained adjustments = adjusted book; statement ending + retained timing evidence = adjusted bank.',
  'Cleared / uncleared movement',
  'Open bank detail',
  'Categorization unavailable',
  'Sign-off unavailable',
]) assert.ok(source.includes(required), `missing reconciliation bridge contract: ${required}`);
assert.ok(!source.includes('onClick={e=>record(r)}'), 'bank categorization must not post from Reconcile');
assert.ok(!source.includes('onClick={signoff}'), 'sign-off must not mutate from Reconcile');
console.log('PASS: Reconcile statement bridge is read-only and preserves item drills.');
