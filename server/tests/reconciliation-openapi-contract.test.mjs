import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));

test('reconciliation OpenAPI mirrors the scoped optimistic lifecycle and no-JE boundary',()=>{
  const worksheet=contract.paths['/entities/{entityId}/bank/reconciliations/{reconciliationId}/worksheet'].get;
  const start=contract.paths['/entities/{entityId}/bank/reconciliations'].post;
  const clearance=contract.paths['/entities/{entityId}/bank/reconciliations/{reconciliationId}/items/{bankSourceId}/clearance'].post;
  const transition=contract.paths['/entities/{entityId}/bank/reconciliations/{reconciliationId}/transitions/{action}'].post;
  assert.equal(start.operationId,'startReconciliation');assert.match(start.description,/cannot create or post a Journal Entry/i);
  assert.equal(worksheet.operationId,'listReconciliationWorksheet');assert.match(worksheet.description,/cannot create a match, clear an item, review, sign off, reopen, or post/i);
  assert.deepEqual(worksheet.parameters.map(item=>item.$ref),['#/components/parameters/EntityId','#/components/parameters/ReconciliationId']);
  assert.equal(worksheet.responses['200'].$ref,'#/components/responses/ReconciliationWorksheetOk');
  assert.equal(clearance.operationId,'setReconciliationClearance');assert.match(clearance.description,/exact ACTIVE match/i);
  assert.equal(transition.operationId,'transitionReconciliation');assert.deepEqual(transition.parameters.find(item=>item.name==='action').schema.enum,['review','sign_off','reopen']);
  for(const operation of [start,clearance,transition])assert.ok(operation.parameters.some(item=>item.$ref==='#/components/parameters/IdempotencyKey'));
  for(const operation of [clearance,transition])assert.ok(operation.parameters.some(item=>item.$ref==='#/components/parameters/IfMatch'));
  const startBody=contract.components.requestBodies.ReconciliationStart.content['application/json'].schema;
  assert.equal(startBody.additionalProperties,false);assert.deepEqual(startBody.required,['bankAccountRef','statementEndingDate','statementOpeningBalance','statementEndingBalance','reason']);
  assert.equal(contract.components.requestBodies.ReconciliationClearance.content['application/json'].schema.additionalProperties,false);
  const row=contract.components.schemas.ReconciliationWorksheetRow;
  assert.equal(row.additionalProperties,false);assert.deepEqual(row.properties.clearance_state.enum,['NOT_CLEARED','CLEARED','UNCLEARED']);
  assert.equal(contract.components.responses.ReconciliationWorksheetOk.headers['Cache-Control'].$ref,'#/components/headers/NoStore');
});
