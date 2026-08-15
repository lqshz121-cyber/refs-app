import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../db/migrations/139_wbs_autorec_match_review_g11_readback.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/139_wbs_autorec_match_review_g11_readback.sql',import.meta.url),'utf8');
const reviewFunction=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_match_review'),migration.indexOf('CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_g11_evidence'));

test('AutoRec match review readback claims G11 INCURRED only from exact completed persisted facts',()=>{
  for(const pattern of [
    /CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_match_review/i,
    /wbs_autorec_g11_completion c/i,
    /release\.command='RELEASE'.*release\.next_state='RELEASED'/is,
    /incur\.command='INCUR'.*incur\.next_state='INCURRED'/is,
    /incur\.version=release\.version\+1/i,
    /journal_accounting_event payable_binding/i,
    /payable_journal\.journal_type='AUTO'.*payable_journal\.status='POSTED'/is,
    /wbs_autorec_g11_completion_line line/i,
    /ledger_line\.ledger_line_id=line\.ledger_line_id/i,
    /incur\.version=\(SELECT max\(latest\.version\)/i,
    /c\.evidence_hash=refs_jsonb_hash/i,
    /'g11_linked',completed,'incurred',completed/i
  ])assert.match(migration,pattern);
  assert.doesNotMatch(reviewFunction,/'g11_linked',true|'incurred',true/i);
  for(const evidencePart of ['mapping_snapshot_id','mapping_snapshot_hash','payable_source_document_id','payable_staging_item_id','autoc_source_document_id','autoc_staging_item_id'])assert.match(reviewFunction,new RegExp(`'${evidencePart}'`));
  assert.match(reviewFunction,/'lines',\(SELECT jsonb_agg\(jsonb_build_object/i);
  assert.match(reviewFunction,/ORDER BY line\.event_type,line\.line_role/i);
});

test('AutoRec match review G11 readback remains entity-scoped, no-store compatible and reversibly fail-closed',()=>{
  assert.match(migration,/refs_assert_scope\(p_tenant,p_entity,'WBS\.AUTOREC\.VIEW'\)/i);
  assert.match(migration,/c\.tenant_id=p_tenant AND c\.entity_id=p_entity/i);
  assert.match(migration,/REVOKE ALL ON FUNCTION refs_get_wbs_autorec_match_review/i);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION refs_get_wbs_autorec_match_review/i);
  assert.match(down,/CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_match_review/i);
  assert.match(down,/'g11_linked',false,'incurred',false/i);
});

test('G11 evidence readback emits every accounting amount as MONEY4 text while retaining raw rows and IDs',()=>{
  assert.match(migration,/CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_g11_evidence/i);
  assert.match(migration,/jsonb_set\(release\.intent->'review_candidate','\{allocated_amount\}'/i);
  assert.match(migration,/'amount',to_char\(ae\.amount,'FM999999999999990\.0000'\)/i);
  assert.match(migration,/'debit_amount',to_char\(line\.debit_amount,'FM999999999999990\.0000'\)/i);
  assert.match(migration,/'credit_amount',to_char\(line\.credit_amount,'FM999999999999990\.0000'\)/i);
  for(const rawProjection of [/'completion',to_jsonb\(c\)/i,/'review',to_jsonb\(r\)/i,/'incur_event',to_jsonb\(incur\)/i])assert.match(migration,rawProjection);
  assert.match(down,/CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_g11_evidence/i);
});
