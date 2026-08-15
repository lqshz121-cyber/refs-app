import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../db/migrations/135_wbs_autorec_match_review.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/135_wbs_autorec_match_review.sql',import.meta.url),'utf8');
const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');

test('AutoRec Bank Match review schema is append-only, scoped, revision-bound, idempotent and audited',()=>{
  for(const pattern of [
    /CREATE TABLE wbs_autorec_match_review/i,
    /decision IN \('ACCEPTED','REJECTED'\)/i,
    /reviewed_by<>matched_by AND reviewed_by<>candidate_prepared_by/i,
    /CREATE TRIGGER wbs_autorec_match_review_append_only/i,
    /ENABLE ROW LEVEL SECURITY/i,
    /refs_assert_scope\(p_tenant,p_entity,'BANK\.MATCH\.REVIEW'\)/i,
    /match_row\.version<>p_expected_match_revision/i,
    /refs_jsonb_hash\(candidate\)<>p_candidate_hash/i,
    /WBS_AUTOREC_MATCH_REVIEW:/i,
    /WBS_AUTOREC_MATCH_REVIEWED/i,
    /permission_used[\s\S]*BANK\.MATCH\.REVIEW/i
  ])assert.match(migration,pattern);
  assert.doesNotMatch(migration,/next_state\s*=\s*'INCURRED'|PAYABLE_INCUR|AUTOC/i);
});

test('AutoRec Bank Match review validates exact candidate and Bank Match source identities without G11 claims',()=>{
  for(const field of ['bank_source_record_id','bank_source_version','business_source_record_id','business_source_version'])assert.match(migration,new RegExp(field));
  assert.match(migration,/match_row\.status<>'ACTIVE'/i);assert.match(migration,/journal_entry_id IS NULL.*journal_line_id IS NULL.*ledger_line_id IS NULL/is);
  assert.match(migration,/'g11_linked',false,'incurred',false/i);
});

test('AutoRec Bank Match review has a SECURITY DEFINER entity-scoped GET and complete down migration',()=>{
  assert.match(migration,/CREATE FUNCTION refs_get_wbs_autorec_match_review[\s\S]*SECURITY DEFINER/i);
  assert.match(migration,/refs_assert_scope\(p_tenant,p_entity,'WBS\.AUTOREC\.VIEW'\)/i);
  assert.match(migration,/r\.tenant_id=p_tenant AND r\.entity_id=p_entity/i);
  assert.match(repository,/async reviewWbsAutoRecBankMatch/);assert.match(repository,/async getWbsAutoRecBankMatchReview/);
  assert.match(down,/DROP FUNCTION refs_get_wbs_autorec_match_review/);assert.match(down,/DROP FUNCTION refs_review_wbs_autorec_bank_match/);assert.match(down,/DROP TABLE wbs_autorec_match_review/);
});
