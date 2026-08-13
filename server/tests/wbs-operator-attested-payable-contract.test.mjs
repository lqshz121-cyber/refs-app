import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/102_wbs_operator_attested_payable_evidence.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/102_wbs_operator_attested_payable_evidence.sql',import.meta.url),'utf8');

test('102 freezes operator evidence as append-only exception data with no accounting writes',()=>{
  for(const token of ['WBS.PAYABLE.OPERATOR_ATTEST','wbs_operator_payable_attestation','wbs_operator_payable_evidence_row','EXCEPTION_REVIEW_REQUIRED','OPERATOR_ATTESTED','signature_verified',"'can_create_draft',false","'can_post',false",'ENABLE ROW LEVEL SECURITY','reject_mutation','idempotency_receipt','audit_event','outbox_event'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/INSERT INTO\s+(?:raw_event|source_document|staging_item|business_document|journal_entry|journal_line|posting_batch|ledger_line)\b/i);
  assert.match(up,/source_system<>'WBS'/);assert.match(up,/source_entity_id IS DISTINCT FROM p_company_codes->>0/);
  assert.match(down,/DROP TABLE wbs_operator_payable_evidence_row/);assert.match(down,/DELETE FROM permission_catalog WHERE permission_code='WBS\.PAYABLE\.OPERATOR_ATTEST'/);
});

test('operator evidence command is permissioned, canonical, scoped, idempotent and non-provider-signed',()=>{
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'WBS\.PAYABLE\.OPERATOR_ATTEST'\)/);
  assert.match(up,/refs_wbs_operator_payable_attest_hash/);assert.match(up,/Idempotency key reused with different request hash/);
  assert.match(up,/UNIQUE\(tenant_id,entity_id,observation_hash\)/);assert.match(up,/item_hash<>refs_jsonb_hash\(item_raw\)/);
  assert.doesNotMatch(up,/wbs_snapshot_delivery_attestation|wbs_snapshot_receipt|signature_verified',true/);
});
