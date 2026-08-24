import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/275_wbs_test_payable_retain_human_draft.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/275_wbs_test_payable_retain_human_draft.sql',import.meta.url),'utf8');

test('275 freezes SERVICE retention and human AP Draft as two exact boundaries',()=>{
  for(const token of ['wbs_test_payable_source_receipt','wbs_test_payable_draft_evidence','refs_retain_wbs_test_payable_source',"refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT')","actor,'SERVICE_ACCOUNT','WBS.TEST.IMPORT'","refs_assert_scope(p_tenant,p_entity,'AP.BILL.CREATE')","actor,'USER','AP.BILL.CREATE'",'p_expected_receipt_hash','receipt_hash','UNSIGNED_TEST_ONLY',"'can_submit',false","'can_review',false","'can_approve',false","'can_post',false"])assert.ok(up.includes(token),token);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft\(uuid,uuid,uuid,jsonb,jsonb,integer,text,text\) FROM PUBLIC,refs_app/);
});

test('275 SERVICE retention contains no business, journal, or lifecycle write',()=>{
  const body=up.match(/CREATE FUNCTION refs_retain_wbs_test_payable_source\([\s\S]+?END \$\$;/)?.[0]??'';assert.ok(body);
  for(const forbidden of ['refs_create_business_document','INSERT INTO business_document','INSERT INTO journal_entry','refs_transition_journal','refs_post_journal'])assert.doesNotMatch(body,new RegExp(forbidden));
});

test('275 rollback is evidence-safe and restores only historical entrypoint',()=>{
  assert.match(down,/Refusing migration 275 rollback: retained WBS test Payable evidence exists/);
  assert.match(down,/GRANT EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft\(uuid,uuid,uuid,jsonb,jsonb,integer,text,text\) TO refs_app/);
});
