import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
const path='/entities/{entityId}/bank/transactions/{bankSourceId}/matches';
const unmatchPath='/entities/{entityId}/bank/transactions/{bankSourceId}/matches/{bankMatchId}/unmatch';
const candidatesPath='/entities/{entityId}/bank/transactions/{bankSourceId}/match-candidates';

test('Bank Match candidate read requires an authenticated scoped source and cannot carry command authority',()=>{
  const operation=contract.paths[candidatesPath]?.get;assert.ok(operation);assert.equal(operation.operationId,'listBankMatchCandidates');
  assert.deepEqual(operation.parameters.map(parameter=>parameter.$ref),['#/components/parameters/EntityId','#/components/parameters/BankSourceId']);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/BankMatchCandidateReadOk');
  assert.match(operation.description,/Zero or multiple rows require the controller to stop/i);
  assert.match(operation.description,/never creates a match/i);
  const response=contract.components.responses.BankMatchCandidateReadOk;
  assert.equal(response.headers['Cache-Control'].schema.const,'no-store');
  const row=response.content['application/json'].schema.properties.data.items;
  assert.deepEqual(row.required,['payment_occurrence_id','occurrence_version','occurrence_kind','business_source_document_id','accounting_date','currency','amount','journal_entry_id','journal_line_id','ledger_line_id','date_delta_days']);
  assert.deepEqual(row.properties.occurrence_kind.enum,['AP_PAYMENT','AR_RECEIPT']);
});

test('Bank Match OpenAPI mirrors the 061 runtime route and optimistic concurrency boundary',()=>{
  const operation=contract.paths[path]?.post;
  assert.ok(operation);
  assert.equal(operation.operationId,'createBankPaymentMatch');
  assert.deepEqual(operation.parameters.map(parameter=>parameter.$ref),[
    '#/components/parameters/EntityId',
    '#/components/parameters/BankSourceId',
    '#/components/parameters/IdempotencyKey',
    '#/components/parameters/IfMatch'
  ]);
  assert.equal(operation.requestBody.$ref,'#/components/requestBodies/BankPaymentMatch');
  assert.equal(operation.responses['200'].$ref,'#/components/responses/CommandReplay');
  assert.equal(operation.responses['201'].$ref,'#/components/responses/CommandCreated');
  assert.equal(operation.responses['412'].$ref,'#/components/responses/PreconditionFailed');
  assert.equal(operation.responses['503'].$ref,'#/components/responses/SerializationRetryExhausted');
  assert.equal(operation.responses.default.$ref,'#/components/responses/Problem');
  assert.match(operation.description,/POSTED AP payment or AR receipt/i);
  assert.match(operation.description,/does not create, modify, approve, or post a journal entry/i);
});

test('Bank Unmatch OpenAPI preserves immutable evidence and requires optimistic concurrency',()=>{
  const operation=contract.paths[unmatchPath]?.post;assert.ok(operation);assert.equal(operation.operationId,'unmatchBankPayment');
  assert.deepEqual(operation.parameters.map(parameter=>parameter.$ref),['#/components/parameters/EntityId','#/components/parameters/BankSourceId','#/components/parameters/BankMatchId','#/components/parameters/IdempotencyKey','#/components/parameters/IfMatch']);
  assert.equal(operation.requestBody.$ref,'#/components/requestBodies/BankPaymentUnmatch');
  assert.match(operation.description,/immutable Journal Entry, ledger, source-link, audit, and prior match evidence are retained/i);
  assert.deepEqual(contract.components.requestBodies.BankPaymentUnmatch.content['application/json'].schema,{type:'object',additionalProperties:false,required:['reason'],properties:{reason:{type:'string',minLength:8,maxLength:2000}}});
});

test('Bank Match request body is strict, source-scoped, and carries no caller-controlled identity',()=>{
  const parameter=contract.components.parameters.BankSourceId;
  assert.deepEqual(parameter,{name:'bankSourceId',in:'path',required:true,schema:{$ref:'#/components/schemas/Uuid'}});
  const schema=contract.components.requestBodies.BankPaymentMatch.content['application/json'].schema;
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual(schema.required,['paymentOccurrenceId','expectedOccurrenceRevision','reason']);
  assert.equal(schema.properties.paymentOccurrenceId.$ref,'#/components/schemas/Uuid');
  assert.deepEqual(schema.properties.expectedOccurrenceRevision,{type:'integer',minimum:0});
  assert.deepEqual(schema.properties.reason,{type:'string',minLength:8,maxLength:2000});
  for(const forbidden of ['actorId','actor_id','tenantId','tenant_id','entityId','entity_id','requestHash','request_hash']){
    assert.equal(JSON.stringify(schema).includes(`\"${forbidden}\"`),false);
  }
});
