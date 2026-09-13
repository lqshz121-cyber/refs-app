import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');

test('native expense account classification correction uses the established chart rule and keeps rollback guarded',async()=>{
  const name='404_native_expense_account_classification_fix.sql';
  const entry=MIGRATION_MANIFEST.find(row=>row.name===name);
  const up=await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/'+name,import.meta.url),'utf8');
  assert.equal(entry?.up,digest(up));
  assert.equal(entry?.down,digest(down));
  for(const token of [
    'RENAME TO refs_create_native_expense_403',
    'RENAME TO refs_read_native_expense_create_options_403',
    "account_code~'^[5-9]'",
    "'Expense category must be an active non-member EXPENSE account'",
    "refs_assert_scope(p_tenant,p_entity,'AP.EXPENSE.CREATE')",
    'finalization_status=\'VERIFIED_CLEAN\'',
    'scan_status=\'CLEAN\'',
    'REVOKE ALL ON FUNCTION refs_create_native_expense_403',
    'GRANT EXECUTE ON FUNCTION refs_create_native_expense'
  ])assert.ok(up.includes(token),token);
  assert.doesNotMatch(up,/AND active AND NOT requires_member AND account_class\\s*=/);
  assert.match(down,/Existing Expenses prevent rollback/);
  assert.match(down,/DROP FUNCTION refs_create_native_expense\(/);
  assert.match(down,/RENAME TO refs_create_native_expense;/);
  assert.match(down,/RENAME TO refs_read_native_expense_create_options;/);
});
