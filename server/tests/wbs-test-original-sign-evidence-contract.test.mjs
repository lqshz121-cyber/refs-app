import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
const name='455_wbs_test_payable_original_sign_evidence.sql';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('original amount evidence is scoped append-only TEST_ONLY and bound to exact source receipt',()=>{
  const sql=read('../db/migrations/'+name);
  for(const token of ['ENABLE ROW LEVEL SECURITY','refs_current_tenant()','refs_entity_allowed(entity_id)','BEFORE UPDATE OR DELETE','EXECUTE FUNCTION reject_mutation()','UNSIGNED_TEST_ONLY','receipt.source_record_hash IS DISTINCT FROM','receipt.observation_hash IS DISTINCT FROM','receipt.provider_content_sha256 IS DISTINCT FROM','receipt.amount IS DISTINCT FROM','saved.source_fact_hash IS DISTINCT FROM fact_hash','WBS_TEST_PAYABLE_ORIGINAL_SIGN_RETAINED'])assert.ok(sql.includes(token),token);
  assert.ok(sql.includes('f.original_amount=r.amount'));assert.ok(sql.includes('FOR SHARE OF f,r'));
  assert.ok(sql.includes('legacy amounts cannot be inferred'));
  assert.match(sql,/refs_create_wbs_test_payable_draft_455[\s\S]*FROM PUBLIC,refs_app/);
  assert.doesNotMatch(sql,/INSERT INTO wbs_test_payable_original_sign_evidence[^;]*SELECT[\s\S]*FROM wbs_test_payable_source_receipt/);
  assert.doesNotMatch(sql,/UPDATE wbs_test_payable_source_receipt|GRANT UPDATE|SIGNED_ADMITTED/);
});
test('original sign migration is registered with exact up/down hashes and one new census table',()=>{
  const entry=MIGRATION_MANIFEST.find(row=>row.name===name);assert.ok(entry);
  for(const [direction,path] of [['up','../db/migrations/'],['down','../db/migrations/down/']])assert.equal(createHash('sha256').update(read(path+name)).digest('hex'),entry[direction]);
  const census=JSON.parse(read('../db/TABLE-CENSUS.json'));assert.equal(census.migration_head,MIGRATION_MANIFEST.at(-1).name);assert.ok(MIGRATION_MANIFEST.findIndex(row=>row.name===census.migration_head)>=MIGRATION_MANIFEST.findIndex(row=>row.name===name));assert.equal(census.table_count,251);assert.equal(census.tables.filter(row=>row.name==='wbs_test_payable_original_sign_evidence'&&row.created_by===name).length,1);
  const down=read('../db/migrations/down/'+name);assert.ok(down.includes('RENAME TO refs_create_wbs_test_payable_draft'));assert.ok(down.includes('DROP TABLE wbs_test_payable_original_sign_evidence'));
});
