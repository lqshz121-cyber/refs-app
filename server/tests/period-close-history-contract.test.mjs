import assert from'node:assert/strict';
import test from'node:test';
import{readFile}from'node:fs/promises';
import{MIGRATION_MANIFEST}from'../runtime/migration-manifest.mjs';

const up=await readFile(new URL('../db/migrations/292_period_close_history_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/292_period_close_history_read.sql',import.meta.url),'utf8');
const openapi=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));

test('Period close history verifies retained audit and outbox evidence before projecting it',()=>{
  for(const token of ["'GL.REPORT.VIEW'",'refs_assert_scope','audit_event_period_close_history_idx',"'PERIOD_CLOSED_V2'","'ACCOUNTING_PERIOD'","'GL.PERIOD.CLOSE'",'SELECT count(*) FROM jsonb_object_keys(a.metadata)','x.payload=p.metadata','x.payload_hash=refs_jsonb_hash(p.metadata)',"'integrity_verified',true"])
    assert.ok(up.includes(token),`missing ${token}`);
  assert.doesNotMatch(up,/jsonb_build_object\([\s\S]{0,120}'reason'\s*,\s*reason/i);
  assert.doesNotMatch(up,/jsonb_build_object\([\s\S]{0,120}'idempotency_key'/i);
  assert.match(up,/'reason_hash',refs_jsonb_hash\(to_jsonb\(reason\)\)/);
  assert.match(up,/'command_reference_hash',refs_jsonb_hash\(to_jsonb\(idempotency_key\)\)/);
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:accounting_period|journal_entry|journal_line|ledger_line|audit_event|outbox_event)\b/i);
});

test('Period close history is keyset paged, read only and manifest bound',()=>{
  for(const token of ['ORDER BY a.occurred_at DESC,a.audit_event_id DESC LIMIT p_limit+1',"'reason_hashed',true","'command_reference_hashed',true","'can_create_draft',false","'can_post',false"])
    assert.ok(up.includes(token),`missing ${token}`);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_read_period_close_history[\s\S]*FROM PUBLIC/);
  assert.match(up,/GRANT EXECUTE ON FUNCTION refs_read_period_close_history[\s\S]*TO refs_app/);
  assert.match(down,/DROP FUNCTION refs_read_period_close_history/);
  assert.match(down,/DROP INDEX audit_event_period_close_history_idx/);
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='292_period_close_history_read.sql'));
});

test('OpenAPI publishes only the closed no-store period close history read',()=>{
  const operation=openapi.paths['/entities/{entityId}/periods/{periodId}/close-history']?.get;assert.equal(operation.operationId,'getPeriodCloseHistory');assert.equal(operation.requestBody,undefined);assert.equal(operation.responses['200'].$ref,'#/components/responses/PeriodCloseHistoryOk');
  for(const name of ['PeriodCloseHistoryDelivery','PeriodCloseHistoryItem','PeriodCloseHistoryPage','PeriodCloseHistoryEnvelope'])assert.equal(openapi.components.schemas[name].additionalProperties,false,name);
  assert.equal(openapi.components.schemas.PeriodCloseHistoryPage.properties.action_flags.$ref,'#/components/schemas/NoAccountingActions');
  assert.equal(openapi.components.responses.PeriodCloseHistoryOk.headers['Cache-Control'].schema.const,'no-store');
});
