import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/097_wbs_payable_review_evidence_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/097_wbs_payable_review_evidence_read.sql',import.meta.url),'utf8');

test('reviewed WBS Payable read is dual-scoped and closed',()=>{
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'WBS\.AUTOREC\.VIEW'\)/);
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AP\.VIEW'\)/);
  assert.match(up,/RETURNS TABLE\([\s\S]*draft_readiness text,can_create_draft boolean/);
  assert.doesNotMatch(up,/p_actor|raw jsonb|normalized jsonb|detached_signature|credential|provider_token/i);
  assert.match(down,/DROP FUNCTION refs_read_wbs_payable_review_evidence/);
});

test('Draft readiness is fully server revalidated and grants no later workflow action',()=>{
  for(const token of ['AP.BILL.CREATE','MAKER_REVIEWER_SOD','PERIOD_NOT_OPEN','ATTACHMENT_EVIDENCE_CHANGED','EVIDENCE_REVALIDATION_FAILED','READY_FOR_AP_DRAFT'])assert.match(up,new RegExp(token.replace('.','\\.')));
  for(const guard of ['VERIFIED_CLEAN','SOURCE_ATTACHMENT','READY_FOR_DRAFT','291001','refs_rule_evaluation_hash','refs_jsonb_hash'])assert.match(up,new RegExp(guard));
  assert.doesNotMatch(up,/INSERT INTO|UPDATE |DELETE FROM|refs_create_wbs_payable_ap_draft\(/i);
});
