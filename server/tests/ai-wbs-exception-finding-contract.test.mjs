import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const up=await readFile(resolve(here,'../db/migrations/115_ai_wbs_exception_findings.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/115_ai_wbs_exception_findings.sql'),'utf8');

test('AI WBS exception findings persist immutable, redacted source trace atomically',()=>{
  assert.match(up,/CREATE TABLE ai_finding/);
  assert.match(up,/UNIQUE\(tenant_id,entity_id,finding_hash\)/);
  assert.match(up,/UNIQUE\(tenant_id,entity_id,source_evidence_row_id\)/);
  assert.match(up,/source_row_hash text NOT NULL CHECK\(source_row_hash~'\^sha256/);
  assert.match(up,/provider_content_hash text NOT NULL CHECK\(provider_content_hash~'\^sha256/);
  assert.match(up,/observation_hash text NOT NULL CHECK\(observation_hash~'\^sha256/);
  assert.match(up,/CREATE TRIGGER ai_finding_append_only BEFORE UPDATE OR DELETE/);
  assert.match(up,/AFTER INSERT ON wbs_operator_payable_evidence_row/);
  assert.match(up,/FOR evidence_id IN SELECT wbs_operator_payable_evidence_row_id FROM wbs_operator_payable_evidence_row/);
  assert.match(up,/PERFORM refs_materialize_ai_wbs_exception_finding\(evidence_id\)/);
  assert.match(up,/INSERT INTO audit_event[\s\S]*'AI_FINDING_MATERIALIZED'/);
  assert.match(up,/INSERT INTO outbox_event[\s\S]*'AI_FINDING_MATERIALIZED'/);
  assert.doesNotMatch(up,/raw[\s\S]{0,120}metadata/i,'raw provider payload must not enter AI audit metadata');
});

test('AI finding is a fail-closed review item, never a journal or posting authority',()=>{
  for(const token of ['can_create_draft','can_review','can_approve','can_post'])assert.match(up,new RegExp(`'${token}',false`));
  assert.match(up,/status text NOT NULL DEFAULT 'OPEN' CHECK\(status='OPEN'\)/);
  assert.match(up,/due_date_status text NOT NULL CHECK\(due_date_status='HUMAN_ASSIGNMENT_REQUIRED'\)/);
  assert.doesNotMatch(up,/INSERT INTO journal_entry/i);
  assert.doesNotMatch(up,/INSERT INTO staging_item/i);
  assert.doesNotMatch(up,/INSERT INTO source_document/i);
});

test('AI finding reader is scoped, bounded, and returns only false action flags',()=>{
  assert.match(up,/PERFORM refs_assert_scope\(p_tenant,p_entity,'WBS\.PAYABLE\.OPERATOR_ATTEST'\)/);
  assert.match(up,/p_limit<1 OR p_limit>100/);
  assert.match(up,/false,false,false,false/);
  assert.match(up,/GRANT EXECUTE ON FUNCTION refs_read_ai_wbs_exception_findings/);
});

test('down migration refuses to erase persisted AI audit evidence',()=>{
  assert.match(down,/IF EXISTS\(SELECT 1 FROM ai_finding\)/);
  assert.match(down,/Cannot remove persisted AI findings/);
});
