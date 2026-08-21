import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const up=await readFile(resolve(here,'../db/migrations/212_ai_bank_duplicate_payment_finding.sql'),'utf8');
const down=await readFile(resolve(here,'../db/migrations/down/212_ai_bank_duplicate_payment_finding.sql'),'utf8');

test('duplicate-payment evidence and every source are append-only, scoped and action-free',()=>{
  for(const table of ['ai_bank_duplicate_payment_finding','ai_bank_duplicate_payment_source']){assert.match(up,new RegExp(`CREATE TABLE ${table}`));assert.match(up,new RegExp(`CREATE TRIGGER ${table}_append_only BEFORE UPDATE OR DELETE`));}
  assert.match(up,/finding->'action_flags'='\{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false\}'::jsonb/);assert.match(up,/UNIQUE\(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id,bank_source_id\)/);assert.match(up,/UNIQUE\(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id,external_bank_line_id\)/);
});

test('database reproduces exact same-account date currency amount and signed admission before writing',()=>{
  for(const predicate of ["bank_row.bank_account_ref IS DISTINCT FROM item->>'bank_account_ref'","bank_row.transaction_date IS DISTINCT FROM (item->>'transaction_date')::date","bank_row.currency IS DISTINCT FROM item->>'currency'","bank_row.amount IS DISTINCT FROM (item->>'amount')::numeric","receipt.signature_verified=true AND receipt.admission_status='ADMITTED'"])assert.ok(up.includes(predicate),predicate);
  assert.match(up,/count\(DISTINCT value->>'bank_source_id'\)/);assert.match(up,/count\(DISTINCT value->>'external_bank_line_id'\)/);
});

test('materialization is actor-idempotent and atomically emits only finding audit and outbox evidence',()=>{
  assert.match(up,/idem\.request_hash IS DISTINCT FROM p_request_hash OR idem\.actor_id IS DISTINCT FROM actor/);assert.match(up,/AI_BANK_DUPLICATE_PAYMENT_MATERIALIZED/);assert.match(up,/INSERT INTO audit_event/);assert.match(up,/INSERT INTO outbox_event/);
  assert.doesNotMatch(up,/INSERT INTO journal_entry/i);assert.doesNotMatch(up,/INSERT INTO staging/i);assert.doesNotMatch(up,/INSERT INTO ledger/i);assert.doesNotMatch(up,/UPDATE bank_source/i);assert.doesNotMatch(up,/UPDATE bank_match/i);
});

test('rollback refuses to erase retained duplicate-payment evidence',()=>{assert.match(down,/Cannot remove retained AI bank duplicate-payment evidence/);});
