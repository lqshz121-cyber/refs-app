import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/122_ai_prepaid_coverage_findings.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/122_ai_prepaid_coverage_findings.sql',import.meta.url),'utf8');

test('insurance/prepaid coverage gaps materialize as immutable, source-bound findings with no accounting authority',()=>{
  for(const token of ['CREATE TABLE ai_prepaid_coverage_finding','PREPAID_COVERAGE_REQUIRED','source_document_line_id','source_payload_hash','source_document_version','source_line_hash','HUMAN_ASSIGNMENT_REQUIRED','AI_PREPAID_COVERAGE_FINDING_MATERIALIZED','outbox_event','reject_mutation','refs_read_ai_prepaid_coverage_findings'])assert.match(up,new RegExp(token));
  assert.match(up,/\(insurance\|policy\|premium\)/);
  assert.match(up,/document_row\.status<>'READY_FOR_DRAFT'/);
  assert.match(up,/ai_amortization_coverage_evidence/);
  assert.match(up,/can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false/);
  assert.doesNotMatch(up,/INSERT INTO journal_entry/i);
  assert.doesNotMatch(up,/UPDATE journal_entry/i);
  assert.doesNotMatch(up,/\bPOST\b/i);
});

test('retained prepaid coverage findings cannot be removed by a migration rollback',()=>{
  assert.match(down,/Cannot remove retained AI prepaid coverage findings/);
  assert.match(down,/DROP TABLE ai_prepaid_coverage_finding/);
});
