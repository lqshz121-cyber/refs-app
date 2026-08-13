import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/107_wbs_operator_signed_source_bridge.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/107_wbs_operator_signed_source_bridge.sql',import.meta.url),'utf8');
const kernel=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
const review=await readFile(new URL('../db/migrations/094_wbs_payable_review_evidence.sql',import.meta.url),'utf8');

test('107 links exception evidence only to an independently signed exact Payable source',()=>{
  for(const token of [
    "refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT')",
    "environment='PRODUCTION'",'wbs_snapshot_delivery_attestation',"source_module='BGDATA.payable'",
    "ingestion_kind='TRANSACTION_CANDIDATE'",'source_record_id=signed_record.source_record_id',
    "signed_record.source_version=operator_record.source_version","signed_record.source_version~'^operator:'",
    "signed_record.raw->>'mcp_row_hash'", "signed_record.normalized->>'upstream_mcp_row_hash'",
    'wbs_operator_payable_evidence_provider_hash','operator_provider_hash.provider_row_hash',
    "signed_record.raw->>'mcp_content_sha256'", "signed_record.normalized->>'upstream_mcp_content_hash'",
    "operator_record.row_hash<>refs_jsonb_hash(operator_record.raw)",
    "operator_evidence_status','EXCEPTION_REVIEW_REQUIRED'","'can_review',false","'can_create_draft',false","'can_post',false"
  ])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(up,/jsonb_array_length\(operator_attestation\.company_codes\)<>1/);
  assert.match(up,/operator_record\.raw->>'company_code'/);
  assert.doesNotMatch(up,/UPDATE\s+(?:wbs_operator_payable|wbs_inbound)|INSERT INTO\s+(?:raw_event|source_document|staging_item|business_document|journal_entry|journal_line|posting_batch|ledger_line)\b/i);
});

test('107 is append-only, importer-only, idempotent, audited, and not a promotion API',()=>{
  for(const token of ['reject_mutation','idempotency_receipt','WBS_OPERATOR_SIGNED_SOURCE_LINKED','audit_event','outbox_event','SERVICE_ACCOUNT'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/WBS\.PAYABLE\.OPERATOR_ATTEST'\);/);
  assert.match(kernel,/async linkWbsOperatorEvidenceToSignedSource/);
  assert.match(kernel,/refs_wbs_operator_signed_source_link_hash/);
  assert.match(kernel,/refs_link_wbs_operator_evidence_to_signed_source/);
  assert.match(down,/Cannot remove immutable WBS operator signed-source links/);
  assert.match(down,/ERRCODE='55000'/);
  assert.match(up,/refs_attest_wbs_operator_payables_105/);
  assert.match(up,/provider row provenance/);
});

test('Payable Review remains independently gated on the signed inbound receipt',()=>{
  for(const token of ['wbs_inbound_row','wbs_inbound_receipt','wbs_snapshot_import','wbs_snapshot_delivery_attestation','wbs_snapshot_receipt'])assert.match(review,new RegExp(token));
  assert.doesNotMatch(review,/wbs_operator_signed_source_link|wbs_operator_payable_evidence_row|operator_attestation/i);
});
