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

test('expense creation reuses approved effective bank-to-cash controls for both selection and write enforcement',async()=>{
  const name='396_native_expense_bank_account_control.sql',entry=MIGRATION_MANIFEST.find(row=>row.name===name);
  const up=await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/'+name,import.meta.url),'utf8');
  assert.equal(entry?.up,digest(up));assert.equal(entry?.down,digest(down));
  for(const token of ['cash_transfer_bank_account_control','mapping_family=\'CASH_TRANSFER_BANK_ACCOUNT\'','currency=p_currency','status=\'APPROVED\'','effective_from<=p_date','effective_to IS NULL OR effective_to>p_date','exact approved effective bank-to-cash-GL control','\'currency\',c.currency'])assert.ok(up.includes(token),token);
  assert.match(down,/Existing Expenses prevent rollback/);
  assert.match(down,/ALTER FUNCTION refs_create_native_expense_395/);
});
