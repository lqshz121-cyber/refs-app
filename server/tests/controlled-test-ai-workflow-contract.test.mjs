import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('migration 176 creates an isolated append-only TEST_ONLY source without weakening formal AI permissions',async()=>{
  const sql=await read('../db/migrations/176_controlled_test_ai_workflow.sql');
  for(const token of ['AI.TEST.WORKFLOW','UNSIGNED_TEST_ONLY','TEST_ONLY','controlled_test_ai_source','refs_derive_controlled_test_ai_source','parent_source_document_id','ENABLE ROW LEVEL SECURITY','reject_mutation'])assert.match(sql,new RegExp(token));
  assert.match(sql,/parent\.status<>'POSTED'/);assert.match(sql,/parent\.document_type<>'WBS_TEST_PAYABLE'/);assert.match(sql,/storage_ref NOT LIKE 'object:\/\/refs-test-only\/%'/);
  assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION refs_create_ai_amortization_draft/);
  assert.doesNotMatch(sql,/UPDATE\s+account_master/i);
  assert.doesNotMatch(sql,/AI\.AMORTIZATION\.(?:DRAFT|PROPOSE).*AI\.TEST\.WORKFLOW/s);
});

test('migration 187 allowlists only the dedicated controlled-test AI source module and fails closed on rollback',async()=>{
  const up=await read('../db/migrations/187_controlled_test_ai_source_module.sql');
  const down=await read('../db/migrations/down/187_controlled_test_ai_source_module.sql');
  assert.match(up,/source_document_source_module_check/);assert.match(up,/'ai_test_prepaid'/);
  assert.doesNotMatch(up,/UPDATE\s+source_document/i);assert.doesNotMatch(up,/WBS_TEST_AI_PREPAID.*payable/s);
  assert.match(down,/source_module='ai_test_prepaid'/);assert.match(down,/ERRCODE='55006'/);
  assert.doesNotMatch(down,/DELETE\s+FROM\s+source_document/i);
});

test('migration 188 corrects only the TEST_ONLY audit actor without widening the core actor allowlist',async()=>{
  const up=await read('../db/migrations/188_controlled_test_ai_audit_actor.sql');
  const down=await read('../db/migrations/down/188_controlled_test_ai_audit_actor.sql');
  assert.match(up,/refs_derive_controlled_test_ai_source/);assert.match(up,/SERVICE_ACCOUNT/);
  assert.match(up,/actor,''SERVICE'',''AI\.TEST\.WORKFLOW''/);assert.doesNotMatch(up,/audit_event_actor_type_check/);
  assert.doesNotMatch(up,/ALTER\s+TABLE\s+audit_event/i);assert.doesNotMatch(up,/CREATE\s+POLICY/i);
  assert.match(down,/source_module='ai_test_prepaid'/);assert.match(down,/ERRCODE='55006'/);
  assert.doesNotMatch(down,/DELETE\s+FROM\s+(?:source_document|audit_event)/i);
});

test('OpenAPI exposes only the explicit staging runner and keeps identity out of its closed body',async()=>{
  const api=JSON.parse(await read('../api/openapi-accounting.json'));
  const route=api.paths['/entities/{entityId}/ai/controlled-test-workflow/run'].post;
  assert.equal(route.operationId,'runControlledTestAiWorkflow');assert.match(route.description,/STAGING TEST ONLY/);assert.match(route.description,/seven distinct static test actors/);
  const request=api.components.schemas.ControlledTestAiWorkflowRequest;
  assert.equal(request.additionalProperties,false);assert.deepEqual(request.required,['periodId','parentSourceDocumentId','coverageStart','coverageEnd','reason']);
  for(const forbidden of ['tenantId','entityId','actorId'])assert.equal(request.properties[forbidden],undefined);
  const result=api.components.schemas.ControlledTestAiWorkflowResult;assert.deepEqual(result.oneOf.map(item=>item.$ref),['#/components/schemas/ControlledTestAiWorkflowPostedResult','#/components/schemas/ControlledTestAiWorkflowPartialResult']);
  const partial=api.components.schemas.ControlledTestAiWorkflowPartialResult;assert.equal(partial.properties.test_only.const,true);assert.equal(partial.properties.provenance_mode.const,'UNSIGNED_TEST_ONLY');assert.equal(partial.properties.retryable.const,true);
  assert.equal((await read('../api/openapi-accounting.json')).match(/"WbsControlledTestBankResult"/g).length,1);
});

test('Render keeps the controlled test AI runner explicitly disabled until its exact OIDC caller is configured',async()=>{
  const yaml=await read('../../render.yaml');
  assert.match(yaml,/REFS_CONTROLLED_TEST_AI_WORKFLOW_MODE\s*\r?\n\s*value: DISABLED/);
  assert.match(yaml,/REFS_CONTROLLED_TEST_AI_CALLER_ACTOR_ID\s*\r?\n\s*sync: false/);
  for(const actor of ['SOURCE_MAKER','PROPOSER','DRAFT_MAKER','SUBMITTER','REVIEWER','APPROVER','POSTER'])assert.match(yaml,new RegExp(`REFS_CONTROLLED_TEST_AI_${actor}_ACTOR_ID`));
});
