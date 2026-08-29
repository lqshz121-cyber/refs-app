import assert from'node:assert/strict';
import test from'node:test';
import{readFile}from'node:fs/promises';
import{MIGRATION_MANIFEST}from'../runtime/migration-manifest.mjs';

const up=await readFile(new URL('../db/migrations/293_period_reopen_control.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/293_period_reopen_control.sql',import.meta.url),'utf8');
const openapi=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));

test('period reopen is an independent CAS and retained-close-evidence command',()=>{
  for(const token of ["'GL.PERIOD.REOPEN'","'REOPEN'","'PERIOD_CLOSED_V2'","'PERIOD_REOPENED_V1'","p_scope NOT LIKE 'REOPEN_PERIOD:%'",'p_expected_close_audit_event_id','p_expected_readiness_hash','v_actor=v_close.actor_id','v_period.version<>p_expected_version','refs_reserve_idempotency','refs_jsonb_hash(v_close.metadata)',"status='OPEN'",'closed_by=NULL','closed_at=NULL'])assert.ok(up.includes(token),`missing ${token}`);
  assert.match(up,/SELECT \* INTO v_period[\s\S]*FOR UPDATE/);
  assert.match(up,/INSERT INTO audit_event[\s\S]*INSERT INTO outbox_event/);
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:journal_entry|journal_line|ledger_line)\b/i);
});

test('period reopen has a guarded rollback and migration manifest entry',()=>{
  assert.match(down,/PERIOD_REOPENED_V1/);assert.match(down,/Cannot remove period reopen control with retained evidence/);
  assert.match(down,/DROP FUNCTION refs_reopen_period_v1/);assert.match(down,/DELETE FROM runtime_human_permission_authority/);
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='293_period_reopen_control.sql'));
});

test('OpenAPI publishes a closed no-store independent reopen command',()=>{
  const operation=openapi.paths['/entities/{entityId}/periods/{periodId}/reopen']?.post;assert.equal(operation.operationId,'reopenAccountingPeriod');assert.equal(operation.requestBody.required,true);assert.equal(operation.responses['200'].$ref,'#/components/responses/PeriodReopenOk');
  assert.equal(openapi.components.schemas.PeriodReopenReceipt.additionalProperties,false);assert.equal(openapi.components.schemas.PeriodReopenReceipt.properties.status.const,'OPEN');assert.equal(openapi.components.schemas.PeriodReopenEnvelope.additionalProperties,false);assert.equal(openapi.components.responses.PeriodReopenOk.headers['Cache-Control'].schema.const,'no-store');
});
