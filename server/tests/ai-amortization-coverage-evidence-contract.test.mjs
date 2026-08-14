import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/121_ai_amortization_coverage_evidence.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/121_ai_amortization_coverage_evidence.sql',import.meta.url),'utf8');

test('amortization coverage evidence is immutable, source-version-bound, and cannot create accounting authority',()=>{
  for(const token of ['CREATE TABLE ai_amortization_coverage_evidence','source_payload_hash','source_document_version','coverage_start','coverage_end','evidence_ref','evidence_hash','extraction_method','coverage_hash','AI.AMORTIZATION.PROPOSE','idempotency_receipt','AI_AMORTIZATION_COVERAGE_EVIDENCE_RECORDED','outbox_event','reject_mutation'])assert.match(up,new RegExp(token));
  assert.match(up,/UNIQUE\(tenant_id,entity_id,source_document_id,source_document_version\)/);
  assert.match(up,/source\.payload_hash<>p_source_payload_hash/);
  assert.match(up,/source\.status<>'READY_FOR_DRAFT'/);
  assert.match(up,/p_coverage_start<>date_trunc\('month',p_coverage_start\)::date/);
  assert.match(up,/p_coverage_end<>\(date_trunc\('month',p_coverage_end\)\+interval '1 month - 1 day'\)::date/);
  assert.match(up,/'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false/);
  assert.doesNotMatch(up,/INSERT INTO journal_entry/i);
  assert.doesNotMatch(up,/UPDATE journal_entry/i);
  assert.doesNotMatch(up,/\bPOST\b/i);
});

test('coverage evidence cannot be rolled back once retained',()=>{
  assert.match(down,/Cannot remove retained AI amortization coverage evidence/);
  assert.match(down,/DROP TABLE ai_amortization_coverage_evidence/);
});
