import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
const operations=Object.values(contract.paths).map(path=>path.post);

test('accounting OpenAPI is 3.1, authenticated and operation ids match the runtime kernel surface',()=>{
  assert.equal(contract.openapi,'3.1.0');assert.deepEqual(contract.security,[{bearerAuth:[]}]);
  assert.deepEqual(operations.map(operation=>operation.operationId).sort(),['createAutoJournal','createJournalAdjustment','createManualJournal','postJournal','transitionJournal']);
});

test('every accounting command requires idempotency and every mutable existing resource requires If-Match',()=>{
  for(const operation of operations)assert.ok(operation.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IdempotencyKey'));
  for(const operation of operations.filter(item=>['transitionJournal','postJournal'].includes(item.operationId)))assert.ok(operation.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IfMatch'));
});

test('identity and server-computed request hash are absent from all public request schemas',()=>{
  const serialized=JSON.stringify(contract.components.requestBodies);
  for(const forbidden of ['actorId','actor_id','tenantId','tenant_id','entityId','entity_id','requestHash','request_hash'])assert.equal(serialized.includes(`\"${forbidden}\"`),false);
});

test('all responses are no-store and use a structured success or problem envelope',()=>{
  assert.equal(contract.components.responses.CommandCreated.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.responses.Problem.headers['Cache-Control'].schema.const,'no-store');
  for(const operation of operations){assert.ok(operation.responses['201']);assert.ok(operation.responses.default);}
});
