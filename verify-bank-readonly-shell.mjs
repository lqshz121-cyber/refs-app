import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-banktx.jsx', import.meta.url), 'utf8');
for (const required of [
  "{h:'Review candidate'",
  'Evidence decision required; no action is available here.',
  'Retained local bank evidence is read-only;',
  'Open evidence detail',
  'This detail is read-only local evidence.',
]) assert.ok(source.includes(required), `missing local read-only bank label: ${required}`);
for (const retired of ['actions.bankRecord', 'actions.bankMatch', 'completeMatch', 'batchAccept', 'Match / Categorize']) {
  assert.ok(!source.includes(retired), `bank write workflow remains in shell: ${retired}`);
}
console.log('bank transaction read-only shell verification passed');
