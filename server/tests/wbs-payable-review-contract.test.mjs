import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/094_wbs_payable_review_evidence.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/094_wbs_payable_review_evidence.sql',import.meta.url),'utf8');

test('review command is a dedicated evidence-only WBS Payable control',()=>{
  assert.match(up,/WBS\.PAYABLE\.REVIEW/);assert.match(up,/WBS_PAYABLE_REVIEWER/);
  assert.match(up,/outcome_kind<>'STAGING'/);assert.match(up,/STAGING_REVIEW_REQUIRED/);assert.match(up,/environment='PRODUCTION'/);
  assert.match(up,/family='WBS_PAYABLE_AP'/);assert.match(up,/status='APPROVED'/);assert.match(up,/mapping_count<>1/);
  assert.match(up,/m\.priority=\(SELECT max\(x\.priority\)/);assert.match(up,/refs_wbs_payable_iso_date/);
  assert.match(up,/member_type='VENDOR'/);assert.match(up,/account_code='291001'/);assert.match(up,/finalization_status='VERIFIED_CLEAN'/);
  assert.match(up,/'READY_FOR_DRAFT'/);assert.match(up,/reviewed_by,reviewed_at/);
  assert.match(up,/'can_create_draft',false/);assert.match(up,/'can_approve',false/);assert.match(up,/'can_post',false/);
  assert.doesNotMatch(up,/INSERT INTO\s+(?:business_document|journal_entry|journal_line|posting_batch|ledger_line)/i);
  assert.doesNotMatch(up,/refs_(?:create_auto_journal|create_business_document|transition_journal|post_journal)\s*\(/i);
});

test('review evidence is immutable, idempotent, CAS-bound and fully reversible',()=>{
  assert.match(up,/INSERT INTO idempotency_receipt/);assert.match(up,/FOR UPDATE/);assert.match(up,/p_expected_revision<>0/);assert.match(up,/expected_evidence_hash/);
  assert.match(up,/WBS payable evidence revision conflict/);assert.match(up,/reviewer SoD violation/);
  assert.match(up,/document_number/);assert.match(up,/due_date/);assert.match(up,/external_trace_hash/);assert.match(up,/external_trace'->>'invoice_no'/);assert.match(up,/external_trace'->>'pay_due_date'/);
  assert.match(up,/wbs_payable_review_evidence_append_only/);assert.match(up,/wbs_payable_review_attachment_append_only/);
  assert.match(up,/UNIQUE\(tenant_id,entity_id,wbs_inbound_row_id\)/);
  assert.match(down,/DROP FUNCTION refs_review_wbs_payable/);assert.match(down,/DROP TABLE wbs_payable_review_attachment/);assert.match(down,/DELETE FROM permission_catalog/);
});
