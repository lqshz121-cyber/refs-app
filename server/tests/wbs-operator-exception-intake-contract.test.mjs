import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/104_wbs_operator_exception_intake.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/104_wbs_operator_exception_intake.sql',import.meta.url),'utf8');
const rowHashUp=await readFile(new URL('../db/migrations/105_wbs_operator_exception_row_hash.sql',import.meta.url),'utf8');
const rowHashDown=await readFile(new URL('../db/migrations/down/105_wbs_operator_exception_row_hash.sql',import.meta.url),'utf8');

test('104 retains unassigned and mixed Production Payables only in the append-only exception domain',()=>{
  for(const token of ['UNASSIGNED_COMPANY','MIXED_COMPANY','SINGLE_COMPANY_UNASSIGNED','ENTITY_SCOPE_MATCHED','EXCEPTION_REVIEW_REQUIRED','OPERATOR_ATTESTED',"'signature_verified',false","'can_import_to_staging',false","'can_review',false","'can_create_draft',false","'can_approve',false","'can_post',false",'idempotency_receipt','audit_event','outbox_event'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/INSERT INTO\s+(?:raw_event|source_document|staging_item|wbs_inbound_row|business_document|journal_entry|journal_line|posting_batch|ledger_line)\b/i);
  assert.match(up,/jsonb_array_length\(p_company_codes\)>10/);assert.match(up,/\^\[A-Za-z0-9\]\[A-Za-z0-9_:-\]\{0,63\}\$/);
  assert.match(up,/count\(DISTINCT value\)/);assert.match(up,/jsonb_agg\(value ORDER BY value\)/);assert.match(up,/NOT p_company_codes \? btrim\(item_raw->>'company_code'\)/);
});

test('104 read protocol never invents a company and down refuses unsafe loss',()=>{
  assert.match(up,/WHEN 1 THEN a\.company_codes->>0 ELSE NULL/);assert.match(up,/a\.company_codes,a\.company_scope_status/);
  assert.doesNotMatch(up,/THEN 'UNASSIGNED'|THEN 'MULTIPLE'/);
  assert.match(down,/company_scope_status<>'ENTITY_SCOPE_MATCHED'/);assert.match(down,/ERRCODE='55000'/);
  assert.match(down,/ALTER TABLE wbs_operator_payable_attestation DROP COLUMN company_scope_status/);
});

test('105 verifies the service request then stores the PostgreSQL-native immutable raw-row hash',()=>{
  assert.match(rowHashUp,/expected_request_hash:=refs_wbs_operator_payable_attest_hash/);
  assert.match(rowHashUp,/jsonb_set\(value,'\{row_hash\}',to_jsonb\(refs_jsonb_hash\(value->'raw'\)\),true\)/);
  assert.match(rowHashUp,/REVOKE ALL ON FUNCTION refs_attest_wbs_operator_payables_104[\s\S]+FROM PUBLIC,refs_app/);
  assert.match(rowHashUp,/GRANT EXECUTE ON FUNCTION refs_attest_wbs_operator_payables[\s\S]+TO refs_app/);
  assert.match(rowHashDown,/DROP FUNCTION refs_attest_wbs_operator_payables/);
  assert.match(rowHashDown,/RENAME TO refs_attest_wbs_operator_payables/);
});
