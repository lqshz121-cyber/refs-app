import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/149_wbs_final1_retained_source_evidence.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/149_wbs_final1_retained_source_evidence.sql',import.meta.url),'utf8');

test('Final-1 retention is exact-scope append-only evidence with no accounting action',()=>{
  for(const token of [
    'CREATE TABLE wbs_final1_retained_evidence_admission','CREATE TABLE wbs_final1_retained_source_row',
    'request_storage_version','response_storage_version','package_storage_version','WBS.SNAPSHOT.IMPORT',
    'refs_wbs_final1_retained_evidence_hash','refs_retain_wbs_final1_source_evidence',
    "source_status_value:=CASE WHEN row_value->>'outcome'='EXCEPTION_REVIEW_REQUIRED' THEN 'QUARANTINED'::source_status ELSE 'PENDING_REVIEW'::source_status END",
    'INSERT INTO raw_event','INSERT INTO source_document','INSERT INTO source_document_line',
    'INSERT INTO accounting_exception','INSERT INTO ai_amortization_coverage_evidence','INSERT INTO ai_prepaid_coverage_finding',
    'SIGNED_SOURCE_FIELD','PREPAID_COVERAGE_REQUIRED','WBS_FINAL1_RETAINED_SOURCE_EVIDENCE_ADMITTED',
    "'can_create_draft',false","'can_review',false","'can_approve',false","'can_post',false"
  ])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/INSERT\s+INTO\s+journal_entry/i);
  assert.doesNotMatch(up,/INSERT\s+INTO\s+ledger_line/i);
  assert.doesNotMatch(up,/UPDATE\s+source_document\s+SET\s+status/i);
  assert.doesNotMatch(up,/'READY_FOR_DRAFT'::source_status/);
});

test('Final-1 retention rollback refuses to erase retained evidence',()=>{
  assert.match(down,/IF EXISTS\(SELECT 1 FROM wbs_final1_retained_evidence_admission\)/);
  assert.match(down,/Cannot remove retained WBS Final-1 evidence/);
  assert.match(down,/DROP FUNCTION refs_retain_wbs_final1_source_evidence/);
});
