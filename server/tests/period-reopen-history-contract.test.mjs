import assert from'node:assert/strict';
import test from'node:test';
import{readFile}from'node:fs/promises';
import{MIGRATION_MANIFEST}from'../runtime/migration-manifest.mjs';

const up=await readFile(new URL('../db/migrations/294_period_reopen_history_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/294_period_reopen_history_read.sql',import.meta.url),'utf8');
const openapi=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));

test('Period reopen history verifies the reopen and exact prior-close audit/outbox chains',()=>{
  for(const token of ["'GL.REPORT.VIEW'",'refs_assert_scope','audit_event_period_reopen_history_idx',"'PERIOD_REOPENED_V1'","'PERIOD_CLOSED_V2'","'GL.PERIOD.REOPEN'","'GL.PERIOD.CLOSE'",'c.audit_event_id::text=a.metadata->>\'prior_close_audit_event_id\'',"c.metadata->>'readiness_hash'=c.after_hash",'ro.payload_hash=refs_jsonb_hash(a.metadata)','co.payload_hash=refs_jsonb_hash(c.metadata)',"c.request_id=c.idempotency_key","c.metadata->>'ledger_evidence_hash'","newer.occurred_at<=a.occurred_at","'integrity_verified',true","'separation_verified',true"])
    assert.ok(up.includes(token),`missing ${token}`);
  assert.match(up,/c\.actor_id<>a\.actor_id/);
  assert.match(up,/\(a\.metadata->>'version'\)::numeric=\(c\.metadata->>'version'\)::numeric\+1/);
  assert.doesNotMatch(up,/jsonb_build_object\([\s\S]{0,120}'reason'\s*,\s*reason/i);
  assert.doesNotMatch(up,/jsonb_build_object\([\s\S]{0,120}'idempotency_key'/i);
  assert.match(up,/'reason_hash',refs_jsonb_hash\(to_jsonb\(reason\)\)/);
  assert.match(up,/'command_reference_hash',refs_jsonb_hash\(to_jsonb\(idempotency_key\)\)/);
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:accounting_period|journal_entry|journal_line|ledger_line|audit_event|outbox_event)\b/i);
});

test('OpenAPI publishes only the closed no-store period reopen history read',()=>{
  const operation=openapi.paths['/entities/{entityId}/periods/{periodId}/reopen-history']?.get;assert.equal(operation.operationId,'getPeriodReopenHistory');assert.equal(operation.requestBody,undefined);assert.equal(operation.responses['200'].$ref,'#/components/responses/PeriodReopenHistoryOk');
  for(const name of ['PeriodReopenHistoryDelivery','PeriodReopenHistoryItem','PeriodReopenHistoryPage','PeriodReopenHistoryEnvelope'])assert.equal(openapi.components.schemas[name].additionalProperties,false,name);
  assert.equal(openapi.components.schemas.PeriodReopenHistoryPage.properties.action_flags.$ref,'#/components/schemas/NoAccountingActions');
  assert.equal(openapi.components.responses.PeriodReopenHistoryOk.headers['Cache-Control'].schema.const,'no-store');
});

test('Period reopen history is keyset paged, read only, reversible, and manifest bound',()=>{
  for(const token of ["p_limit IS NULL", "date_trunc('milliseconds',a.occurred_at AT TIME ZONE 'UTC')", "GROUP BY a.metadata->>'version' HAVING count(*)<>1", "'reopened_by_hash',refs_jsonb_hash(to_jsonb(actor_id))", "'prior_closed_by_hash',refs_jsonb_hash(to_jsonb(metadata->>'prior_closed_by'))", "'reason_hashed',true","'command_reference_hashed',true","'can_create_draft',false","'can_post',false"])
    assert.ok(up.includes(token),`missing ${token}`);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_read_period_reopen_history[\s\S]*FROM PUBLIC/);
  assert.match(up,/GRANT EXECUTE ON FUNCTION refs_read_period_reopen_history[\s\S]*TO refs_app/);
  assert.match(down,/DROP FUNCTION refs_read_period_reopen_history/);
  assert.match(down,/DROP INDEX audit_event_period_reopen_history_idx/);
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='294_period_reopen_history_read.sql'));
});
