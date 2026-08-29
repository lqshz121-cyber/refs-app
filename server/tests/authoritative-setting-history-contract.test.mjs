import assert from'node:assert/strict';
import test from'node:test';
import{readFile}from'node:fs/promises';
import{MIGRATION_MANIFEST}from'../runtime/migration-manifest.mjs';

const up=await readFile(new URL('../db/migrations/291_authoritative_setting_history_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/291_authoritative_setting_history_read.sql',import.meta.url),'utf8');

test('Settings history is entity scoped, immutable, permissioned and keyset paged',()=>{
  for(const token of [
    "'AI.ACCOUNTING.SETTINGS.VIEW'",'refs_assert_scope','setting_snapshot_entity_family_history_idx',
    'ORDER BY s.version DESC,s.setting_snapshot_id DESC LIMIT p_limit+1',
    "'AUTHORITATIVE_SETTING_HISTORY_PAGE_V1'","'snapshot_body_excluded',true",
    "'retirement_reason_hashed',true","'can_create_draft',false","'can_post',false"
  ])assert.ok(up.includes(token),`missing ${token}`);
  assert.doesNotMatch(up,/jsonb_build_object\([\s\S]{0,80}'snapshot'\s*,\s*s\.snapshot/i);
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:setting_snapshot|journal_entry|journal_line|ledger_line|audit_event|outbox_event)\b/i);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_read_authoritative_setting_history[\s\S]*FROM PUBLIC/);
  assert.match(up,/GRANT EXECUTE ON FUNCTION refs_read_authoritative_setting_history[\s\S]*TO refs_app/);
  assert.match(down,/DROP FUNCTION refs_read_authoritative_setting_history/);
  assert.match(down,/DROP INDEX setting_snapshot_entity_family_history_idx/);
});

test('Settings history reports bounded retained reference classes without claiming inferred use',()=>{
  for(const token of ["'entity_period_bindings'","'rule_evaluations'","'staging_items'","'wbs_reviews'","'ai_evidence'","'reference_classes'"])
    assert.ok(up.includes(token),`missing ${token}`);
  assert.doesNotMatch(up,/transaction_usage|used_by_transaction|business_usage/i);
});

test('Settings history migration is manifest bound',()=>{
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='291_authoritative_setting_history_read.sql'));
});
