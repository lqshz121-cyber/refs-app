import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-banktx.jsx', import.meta.url), 'utf8');
for (const required of [
  'Evidence decision',
  'Decision labels are read-only',
  'Property / project / loan',
  'Reason code',
  'Open evidence detail',
  'Batch decision unavailable',
]) assert.ok(source.includes(required), `missing Bank decision contract: ${required}`);
assert.ok(!source.includes('onClick={()=>accept(r)}'), 'bank row action must not mutate evidence');
assert.ok(!source.includes('actions.bankExclude(acctCode,r.bank_txn_id)'), 'bank row action must not exclude a transaction');
console.log('PASS: Bank decision panel is read-only and preserves full-page evidence drill.');
