import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const upUrl=new URL('../db/migrations/184_wbs_test_bank_adjustment_stage_batch.sql',import.meta.url);
const downUrl=new URL('../db/migrations/down/184_wbs_test_bank_adjustment_stage_batch.sql',import.meta.url);

test('migration 184 exposes actor-owned TEST_ONLY Bank stages without actor delegation',async()=>{
  const sql=await readFile(upUrl,'utf8');
  const publicFunctions=[
    'refs_wbs_test_bank_adjustment_draft_batch',
    'refs_wbs_test_bank_adjustment_submit_batch',
    'refs_wbs_test_bank_adjustment_review_batch',
    'refs_wbs_test_bank_adjustment_approve_batch',
    'refs_wbs_test_bank_adjustment_post_clear_batch'
  ];
  for(const name of publicFunctions){
    assert.match(sql,new RegExp(`CREATE FUNCTION ${name}\\(`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION ${name}\\([^;]+ TO refs_app;`));
  }
  assert.doesNotMatch(sql,/p_actor\b|SET LOCAL refs\.actor|set_config\([^)]*actor/i);
  assert.ok((sql.match(/refs_current_actor\(\)/g)||[]).length>=5);
  assert.doesNotMatch(sql,/refs_assert_scope\(p_tenant,p_entity,'WBS\.TEST\.IMPORT'\)/);
  assert.match(sql,/refs_assert_scope\(p_tenant,p_entity,'BANK\.RECONCILIATION\.ADJUSTMENT_DRAFT'\)/);
  assert.match(sql,/refs_assert_scope\(p_tenant,p_entity,'GL\.JE\.SUBMIT'\)/);
  assert.match(sql,/refs_assert_scope\(p_tenant,p_entity,'GL\.JE\.REVIEW'\)/);
  assert.match(sql,/refs_assert_scope\(p_tenant,p_entity,'GL\.JE\.APPROVE'\)/);
  assert.match(sql,/refs_assert_scope\(p_tenant,p_entity,'GL\.JE\.POST'\)/);
  assert.match(sql,/refs_assert_scope\(p_tenant,p_entity,'BANK\.RECONCILIATION\.CLEAR'\)/);
});

test('migration 184 keeps batches bounded, canonical and inside retained monthly imports',async()=>{
  const sql=await readFile(upUrl,'utf8');
  assert.match(sql,/item_count NOT BETWEEN 1 AND 100/);
  assert.match(sql,/array_position\(p_bank_source_ids,NULL\) IS NOT NULL/);
  assert.match(sql,/array_agg\(source_id ORDER BY source_id\),count\(DISTINCT source_id\)/);
  assert.match(sql,/rec\.bank_account_ref!~'\^WBS_TEST_BANK\(\?:_2026_0\[1-6\]\)\?\$'/);
  assert.match(sql,/JOIN wbs_controlled_test_bank_import_row imported_row/);
  assert.match(sql,/JOIN bank_source source/);
  assert.match(sql,/source\.bank_account_ref=rec\.bank_account_ref AND source\.currency=rec\.currency/);
  assert.match(sql,/FOR SHARE/);
});

test('migration 184 reuses exact per-item commands and child idempotency identities',async()=>{
  const sql=await readFile(upUrl,'utf8');
  assert.match(sql,/refs_create_reconciliation_adjustment_draft\(/);
  assert.match(sql,/refs_transition_journal\(/);
  assert.match(sql,/refs_post_journal\(/);
  assert.match(sql,/refs_set_reconciliation_adjustment_clearance\(/);
  assert.match(sql,/p_idempotency_root\|\|':'\|\|source_id\|\|':draft'/);
  assert.match(sql,/CASE p_action WHEN 'SUBMIT' THEN 'submit' WHEN 'REVIEW' THEN 'review-je' ELSE 'approve' END/);
  assert.match(sql,/p_idempotency_root\|\|':'\|\|source_id\|\|':post'/);
  assert.match(sql,/p_idempotency_root\|\|':'\|\|source_id\|\|':clear-adjustment'/);
  assert.match(sql,/refs_canonical_jsonb_hash\(jsonb_build_object\('tenantId'/);
  assert.doesNotMatch(sql,/INSERT INTO (journal_entry|journal_line|ledger_line|audit_event|outbox_event|idempotency_receipt)/i);
});

test('migration 184 keeps helpers private and down removes only its functions',async()=>{
  const [up,down]=await Promise.all([readFile(upUrl,'utf8'),readFile(downUrl,'utf8')]);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_private_wbs_test_bank_adjustment_batch_ids\([^;]+ FROM PUBLIC,refs_app;/);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_private_wbs_test_bank_adjustment_transition_batch\([^;]+ FROM PUBLIC,refs_app;/);
  assert.ok((down.match(/DROP FUNCTION refs_wbs_test_bank_adjustment_/g)||[]).length===5);
  assert.ok((down.match(/DROP FUNCTION refs_private_wbs_test_bank_adjustment_/g)||[]).length===2);
  assert.doesNotMatch(down,/DROP TABLE|DELETE FROM|UPDATE /i);
});

test('enabled WBS TEST_ONLY readiness pins all five Bank stage batch commands',async()=>{
  const server=await readFile(new URL('../runtime/accounting-server.mjs',import.meta.url),'utf8');
  for(const name of ['draft','submit','review','approve','post_clear'])assert.match(server,new RegExp(`to_regprocedure\\('refs_wbs_test_bank_adjustment_${name}_batch`));
});
