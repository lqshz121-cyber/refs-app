import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../db/migrations/241_ai_closing_settlement_source_read.sql',import.meta.url),'utf8');
const down=fs.readFileSync(new URL('../db/migrations/down/241_ai_closing_settlement_source_read.sql',import.meta.url),'utf8');

test('closing settlement reader is explanation-only, period-scoped, bounded and excludes untrusted source states',()=>{
  assert.match(sql,/refs_assert_scope\(p_tenant,p_entity,'AI\.ANALYSIS\.EXPLAIN'\)/);
  assert.match(sql,/p_limit<1 OR p_limit>500/);
  assert.match(sql,/d\.source_module='closing'/);
  assert.match(sql,/d\.accounting_date BETWEEN p\.starts_on AND p\.ends_on/);
  assert.match(sql,/d\.status NOT IN\('RECEIVED','VALIDATING','QUARANTINED','REJECTED','EXCLUDED','DUPLICATE'\)/);
  assert.match(sql,/refs_jsonb_hash\(jsonb_build_object/);
  assert.doesNotMatch(sql,/raw_event\.payload|storage_ref|authorization|credential|token|password/i);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test('closing settlement reader has least privilege and reversible migration',()=>{
  assert.match(sql,/REVOKE ALL ON FUNCTION refs_read_ai_closing_settlement_source/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION refs_read_ai_closing_settlement_source\(uuid,uuid,uuid,integer\) TO refs_app/);
  assert.match(down,/DROP FUNCTION refs_read_ai_closing_settlement_source\(uuid,uuid,uuid,integer\)/);
});
