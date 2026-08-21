import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const sql=fs.readFileSync(new URL('../db/migrations/227_ai_new_vendor_material_invoice_policy.sql',import.meta.url),'utf8');
test('new-vendor material invoice policy is approved, entity-scoped, hash-bound and fail closed',()=>{
  for(const token of ['refs_assert_ai_analysis_scope','AI_NEW_VENDOR_MATERIAL_INVOICE_POLICY','scope_type=\'ENTITY\'','status=\'APPROVED\'','match_count<>1','refs_jsonb_hash','AI_NEW_VENDOR_MATERIAL_INVOICE_POLICY_SNAPSHOT_V1','AI_NEW_VENDOR_MATERIAL_INVOICE_V1','material_amount','REVOKE ALL','GRANT EXECUTE'])assert.match(sql,new RegExp(token));
  assert.doesNotMatch(sql,/CREATE TABLE|INSERT INTO|UPDATE\s|DELETE FROM/i);
});
