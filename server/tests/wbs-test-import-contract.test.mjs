import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/168_wbs_test_payable_draft.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/168_wbs_test_payable_draft.sql',import.meta.url),'utf8');

test('168 isolates an explicitly unsigned test-only WBS Payable Draft behind its own permission',()=>{
  for(const token of [
    'WBS.TEST.IMPORT','WBS_TEST_IMPORTER','WBS_LIVE_PILOT_OBSERVATION_V1','NOT_ADMITTED','UNSIGNED_PILOT',
    'UNSIGNED_TEST_ONLY','test_only','refs_create_wbs_test_payable_draft_hash','refs_create_wbs_test_payable_draft',
    'refs_finalize_wbs_test_import_source_hash','refs_finalize_wbs_test_import_source','WBS_TEST_SOURCE_POSTED',
    "refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT')",'WBS_TEST_VENDOR','610000','VERIFIED_CLEAN',
    'WBS_TEST_SOURCE','SOURCE_ATTACHMENT','SOURCE_TO_JE','refs_create_business_document','WBS_TEST_PAYABLE_DRAFT_CREATED',
    'ENABLE ROW LEVEL SECURITY','reject_mutation','idempotency_receipt','audit_event','outbox_event',
    'source_accounting_date','posting_date','original_accounting_date','posting_accounting_date'
  ])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/WBS\.SNAPSHOT\.IMPORT/);
  assert.doesNotMatch(up,/SIGNED_OBJECT_LOCK|signature_verified',true|s3:\/\//);
  assert.match(up,/UNIQUE\(tenant_id,entity_id,observation_hash,source_record_hash\)/);
  assert.match(up,/p_observation->'rows'->p_row_index IS DISTINCT FROM p_row/);
  assert.match(up,/posting_date:=greatest\(period_row\.starts_on,least\(source_accounting_date,period_row\.ends_on\)\)/);
  assert.match(up,/document_number,source_accounting_date,posting_date,currency,amount/);
  assert.match(up,/business_state<>'OPEN' OR journal_state<>'POSTED'/);
  assert.match(up,/source_state NOT IN \('READY_FOR_DRAFT','POSTED'\)/);
  assert.match(down,/ERRCODE='55006'/);
  assert.match(down,/DELETE FROM permission_catalog WHERE permission_code='WBS\.TEST\.IMPORT'/);
});

test('168 keeps the standard AP maker and downstream SoD chain intact',()=>{
  assert.match(up,/refs_create_business_document_hash/);
  assert.match(up,/refs_create_business_document\(/);
  assert.doesNotMatch(up,/refs_transition_journal|refs_post_journal|GL\.JE\.(REVIEW|APPROVE|POST)/);
  assert.match(up,/'status','DRAFT','revision',0/);
});
