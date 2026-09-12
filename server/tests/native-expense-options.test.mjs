import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');

test('expense creation options are scoped, read-only and limited to verified support',async()=>{
  const name='395_native_expense_create_options.sql',entry=MIGRATION_MANIFEST.find(row=>row.name===name);
  const up=await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/'+name,import.meta.url),'utf8');
  assert.equal(entry?.up,digest(up));assert.equal(entry?.down,digest(down));
  for(const token of ["refs_assert_scope(p_tenant,p_entity,'AP.EXPENSE.CREATE')","status='OPEN'","member_type='VENDOR'","member_type='BANK'","required_member_type='BANK'","account_class='EXPENSE'","finalization_status='VERIFIED_CLEAN'","scan_status='CLEAN'","verified_at IS NOT NULL","finalized_at IS NOT NULL","LIMIT 100"])assert.ok(up.includes(token),token);
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\b/i);
});
