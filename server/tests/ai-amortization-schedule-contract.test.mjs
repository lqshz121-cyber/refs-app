import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const up=await readFile(resolve(here,'../db/migrations/119_ai_amortization_schedule_proposal.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/119_ai_amortization_schedule_proposal.sql'),'utf8');

test('AI amortization plan is immutable, source-hash bound, and has deterministic monthly residual allocation',()=>{
  for(const table of ['ai_amortization_schedule','ai_amortization_schedule_line'])assert.match(up,new RegExp(`CREATE TABLE ${table}`));
  assert.match(up,/source_payload_hash text NOT NULL CHECK\(source_payload_hash ~ '\^sha256/);
  assert.match(up,/source_document_version bigint NOT NULL/);
  assert.match(up,/coverage_start date NOT NULL/);assert.match(up,/coverage_end date NOT NULL/);
  assert.match(up,/UNIQUE\(tenant_id,entity_id,source_document_id\)/);
  assert.match(up,/CREATE TRIGGER ai_amortization_schedule_append_only BEFORE UPDATE OR DELETE/);
  assert.match(up,/CREATE TRIGGER ai_amortization_schedule_line_append_only BEFORE UPDATE OR DELETE/);
  assert.match(up,/base_amount:=trunc\(source\.gross_amount\/months,4\); last_amount:=source\.gross_amount-\(base_amount\*\(months-1\)\)/);
  assert.match(up,/generate_series\(date_trunc\('month',p_coverage_start\),date_trunc\('month',p_coverage_end\),interval '1 month'\)/);
});

test('proposal fails closed without source, whole-month coverage, exact dimensions, active accounts, or canonical idempotency',()=>{
  assert.match(up,/PERFORM refs_assert_scope\(p_tenant,p_entity,'AI\.AMORTIZATION\.PROPOSE'\)/);
  assert.match(up,/source\.payload_hash<>p_source_payload_hash/);
  assert.match(up,/source\.status<>'READY_FOR_DRAFT'/);
  assert.match(up,/p_coverage_start<>date_trunc\('month',p_coverage_start\)::date/);
  assert.match(up,/member trace is absent, ambiguous, or does not exactly match the source/);
  assert.match(up,/prepaid account is inactive or missing/);assert.match(up,/expense account is inactive or missing/);
  assert.match(up,/Idempotency key reused with a different AI amortization proposal/);
  assert.match(up,/refs_propose_ai_amortization_schedule_hash/);
});

test('proposal emits an audit/outbox event but cannot create a Draft, review, approve, or post',()=>{
  assert.match(up,/INSERT INTO audit_event[\s\S]*'AI_AMORTIZATION_PROPOSED'/);
  assert.match(up,/INSERT INTO outbox_event[\s\S]*'AI_AMORTIZATION_PROPOSED'/);
  for(const token of ['can_create_draft','can_review','can_approve','can_post'])assert.match(up,new RegExp(`'${token}',false`));
  assert.doesNotMatch(up,/INSERT INTO journal_entry/i);
  assert.doesNotMatch(up,/UPDATE source_document/i);
  assert.doesNotMatch(up,/UPDATE staging_item/i);
});

test('down migration refuses to erase retained amortization evidence',()=>{
  assert.match(down,/IF EXISTS\(SELECT 1 FROM ai_amortization_schedule\)/);
  assert.match(down,/Cannot remove retained AI amortization proposals/);
});
