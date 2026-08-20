import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/255_ai_accounting_posted_outcome_review.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/255_ai_accounting_posted_outcome_review.sql',import.meta.url),'utf8');

test('255 derives Posted outcome evidence from authoritative accounting tables only',()=>{
  for(const token of ['ai_accounting_decision','ai_accounting_human_decision','ai_accounting_decision_draft_evidence','journal_entry','journal_line','ledger_line','audit_event','outbox_event','financial_statement_snapshot','financial_statement_snapshot_row'])assert.match(up,new RegExp(`\\b${token}\\b`));
  assert.match(up,/p_expected_decision_hash text,p_expected_review_revision bigint,\s*p_idempotency_key text,p_request_hash text/);
  assert.doesNotMatch(up,/p_(packet|policy|journal|ledger|workflow|report|snapshot|evidence)\s/);
  assert.match(up,/AI\.ANALYSIS\.EXPLAIN/);
  assert.doesNotMatch(up,/PERFORM\s+refs_assert_scope\([^;]+GL\.JE\.(SUBMIT|REVIEW|APPROVE|POST)/);
});

test('255 is append-only, CAS/idempotency/audit/outbox bound and all accounting actions remain false',()=>{
  assert.match(up,/review_revision bigint NOT NULL/);
  assert.match(up,/current_revision<>p_expected_review_revision/);
  assert.match(up,/Idempotency key reused with different payload or actor/);
  assert.match(up,/AI_ACCOUNTING_POSTED_OUTCOME_REVIEWED/);
  assert.match(up,/can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false/);
  assert.match(up,/CREATE TRIGGER ai_accounting_posted_outcome_review_append_only/);
  assert.match(down,/Cannot remove retained AI accounting Posted outcome reviews/);
});

test('255 keeps missing, ambiguous and mismatch evidence fail closed',()=>{
  for(const status of ['CONSISTENT','MISSING','AMBIGUOUS','MISMATCH'])assert.match(up,new RegExp(`'${status}'`));
  for(const code of ['HUMAN_ACCEPTANCE_MISSING','DRAFT_RECEIPT_MISSING','POSTED_JOURNAL_MISSING','WORKFLOW_EVIDENCE_AMBIGUOUS','LEDGER_MISMATCH','REPORT_SNAPSHOT_MISSING','REPORT_SNAPSHOT_MISMATCH'])assert.match(up,new RegExp(code));
  assert.match(up,/workflow_audit_count=4 AND workflow_outbox_count=4/);
  assert.match(up,/proposed_matches:=journal_lines=proposed_lines/);
  assert.match(up,/snapshot\.snapshot_hash=refs_jsonb_hash\(snapshot_rows\)/);
});
