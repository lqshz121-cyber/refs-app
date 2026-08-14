import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const up=await readFile(resolve(here,'../db/migrations/123_ai_duplicate_payable_findings.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/123_ai_duplicate_payable_findings.sql'),'utf8');

test('exact duplicate payable findings require singular supplier and exact accounting identity',()=>{
  assert.match(up,/CREATE TABLE ai_duplicate_payable_finding/);
  assert.match(up,/source_module<>'payable'/);assert.match(up,/lower\(btrim\(d\.document_no\)\)=lower\(btrim\(source_row\.document_no\)\)/);
  assert.match(up,/d\.currency=source_row\.currency AND d\.gross_amount=source_row\.gross_amount/);
  assert.match(up,/IF cardinality\(refs\)<>1 THEN RETURN NULL/);assert.match(up,/candidate_party IS DISTINCT FROM source_party/);
  assert.match(up,/CHECK\(source_document_id::text<candidate_source_document_id::text\)/);assert.match(up,/UNIQUE\(tenant_id,entity_id,source_document_id,candidate_source_document_id,rule_id\)/);
});

test('duplicate finding is immutable evidence and cannot alter source or accounting authority',()=>{
  assert.match(up,/CREATE TRIGGER ai_duplicate_payable_finding_append_only BEFORE UPDATE OR DELETE/);
  assert.match(up,/AI_DUPLICATE_PAYABLE_FINDING_MATERIALIZED/);assert.match(up,/INSERT INTO outbox_event/);
  for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.match(up,new RegExp(`'${field}',false`));
  assert.doesNotMatch(up,/INSERT INTO journal_entry/i);assert.doesNotMatch(up,/UPDATE source_document/i);assert.doesNotMatch(up,/status='DUPLICATE'/i);
});

test('duplicate finding reader is bounded, scoped, and rollback preserves retained evidence',()=>{
  assert.match(up,/refs_read_ai_duplicate_payable_findings/);assert.match(up,/p_limit<1 OR p_limit>100/);assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.AMORTIZATION\.PROPOSE'\)/);
  assert.match(down,/Cannot remove retained AI duplicate payable findings/);assert.doesNotMatch(down,/DROP TABLE ai_duplicate_payable_finding[\s\S]*DELETE/i);
});
