import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {assertAiAccountingDecisionPacketFullBatch,createAiAccountingApprovedDecisionService} from '../runtime/ai-accounting-approved-decision-service.mjs';
import {createAccountingApi} from '../api/accounting-http.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=c=>`sha256:${c.repeat(64)}`;
const tenantId=id(1),entityId=id(2),periodId=id(3),documentId=id(4),lineId=id(5);
const source={source_document_id:documentId,source_document_line_id:lineId,source_payload_hash:hash('a'),source_line_hash:hash('b')},classification={source_document_id:documentId,source_document_line_id:lineId,source_payload_hash:hash('a'),source_line_hash:hash('b'),classification:'EXPENSE'};
const packet={schema_version:'AI_ACCOUNTING_DECISION_PACKET_V1',status:'READY_FOR_HUMAN_REVIEW',tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId,proposed_journal:{status:'SUGGESTED_ONLY',lines:[{},{}]},expected_report_deltas:[{}],action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}};

const service=overrides=>createAiAccountingApprovedDecisionService({sourceReader:async()=>[source],classificationService:{analyze:async()=>({results:[classification]})},scheduleReader:async()=>[],settingsAdapter:{buildInvoice:async()=>packet},...overrides});

test('server-only decision service binds exact source/classification lineage and exposes four false actions',async()=>{
  const calls=[],result=await service({settingsAdapter:{buildInvoice:async input=>(calls.push(input),packet)}}).analyze({tenantId,entityId,accountingPeriodId:periodId,limit:10});
  assert.equal(result.row_count,1);assert.equal(result.decision_counts.ready_for_human_review,1);assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  assert.equal(calls[0].retainedSource,source);assert.equal(calls[0].classification,classification);assert.equal(calls[0].amortizationScheduleTrace,null);
  assert.equal(assertAiAccountingDecisionPacketFullBatch(result,{tenantId,entityId,accountingPeriodId:periodId}),result);
});

test('only one exact retained amortization schedule can bind and changed lineage fails closed before packet build',async()=>{
  const schedule={source_document_id:documentId,source_payload_hash:hash('a'),status:'PROPOSED',ai_amortization_schedule_id:id(8),proposal_hash:hash('c'),can_create_draft:false,can_review:false,can_approve:false,can_post:false},calls=[];
  await service({scheduleReader:async()=>[schedule],settingsAdapter:{buildInvoice:async input=>(calls.push(input),packet)}}).analyze({tenantId,entityId,accountingPeriodId:periodId});
  assert.deepEqual(calls[0].amortizationScheduleTrace,{schedule_id:id(8),schedule_hash:hash('c')});
  await assert.rejects(service({sourceReader:async()=>[{...source,source_line_hash:hash('d')}]}).analyze({tenantId,entityId,accountingPeriodId:periodId}),error=>error.code==='AI_ACCOUNTING_DECISION_POPULATION_MISMATCH');
  await assert.rejects(service({scheduleReader:async()=>[schedule,{...schedule,ai_amortization_schedule_id:id(9),proposal_hash:hash('d')}]}).analyze({tenantId,entityId,accountingPeriodId:periodId}),error=>error.code==='AI_ACCOUNTING_APPROVED_SETTINGS_UNAVAILABLE');
});

test('a saturated bounded schedule read cannot turn an unobserved prepaid schedule into false absence',async()=>{
  const schedule={source_document_id:documentId,source_payload_hash:hash('a'),status:'PROPOSED',ai_amortization_schedule_id:id(8),proposal_hash:hash('c'),can_create_draft:false,can_review:false,can_approve:false,can_post:false},prepaid={...classification,classification:'PREPAID_AMORTIZATION'},unrelated=Array.from({length:100},(_,index)=>({...schedule,ai_amortization_schedule_id:id(100+index),source_document_id:id(300+index),source_payload_hash:hash(String(index%10)),proposal_hash:hash(String((index+1)%10))}));
  await assert.rejects(service({classificationService:{analyze:async()=>({results:[prepaid]})},scheduleReader:async()=>unrelated}).analyze({tenantId,entityId,accountingPeriodId:periodId}),error=>error.code==='AI_ACCOUNTING_AMORTIZATION_SCHEDULE_POPULATION_INCOMPLETE');
  const exact={...schedule,status:'PROPOSED',can_create_draft:false,can_review:false,can_approve:false,can_post:false},calls=[];
  await service({classificationService:{analyze:async()=>({results:[prepaid]})},scheduleReader:async()=>[exact,...unrelated.slice(0,99)],settingsAdapter:{buildInvoice:async input=>(calls.push(input),packet)}}).analyze({tenantId,entityId,accountingPeriodId:periodId});
  assert.equal(calls.length,1);assert.deepEqual(calls[0].amortizationScheduleTrace,{schedule_id:exact.ai_amortization_schedule_id,schedule_hash:exact.proposal_hash});
});

test('reader or settings failure produces no model, JE, audit, or outbox command surface',async()=>{
  let buildCalls=0;
  await assert.rejects(service({sourceReader:async()=>{throw Object.assign(new Error('database unavailable'),{code:'SERIALIZATION_RETRY_EXHAUSTED'});},settingsAdapter:{buildInvoice:async()=>{buildCalls+=1;}}}).analyze({tenantId,entityId,accountingPeriodId:periodId}),error=>error.code==='SERIALIZATION_RETRY_EXHAUSTED');
  assert.equal(buildCalls,0);assert.deepEqual(Object.keys(service()),['analyze']);
});

test('a batch cannot mix parent approved settings snapshots',async()=>{
  const secondSource={...source,source_document_id:id(6),source_document_line_id:id(7),source_payload_hash:hash('d'),source_line_hash:hash('e')},secondClassification={...classification,source_document_id:id(6),source_document_line_id:id(7),source_payload_hash:hash('d'),source_line_hash:hash('e')};let calls=0;
  await assert.rejects(service({sourceReader:async()=>[source,secondSource],classificationService:{analyze:async()=>({results:[classification,secondClassification]})},settingsAdapter:{buildInvoice:async()=>({...packet,settings_snapshot_id:id(++calls),settings_snapshot_hash:hash(String(calls))})}}).analyze({tenantId,entityId,accountingPeriodId:periodId}),error=>error.code==='AI_ACCOUNTING_APPROVED_SETTINGS_UNAVAILABLE');
});

test('existing GET decision route accepts the closed full batch and maps approved-settings failure to no-store 503',async()=>{
  const batch={schema_version:'AI_ACCOUNTING_DECISION_PACKET_FULL_BATCH_V1',scope:{tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId},row_count:1,decision_counts:{ready_for_human_review:1,exception:0},packets:[packet],action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}},url=`/api/v1/entities/${entityId}/ai/accounting-decisions?periodId=${periodId}`;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'human-controller'}),kernelFactory:()=>({}),aiAccountingDecisionPacketServiceFactory:async()=>({analyze:async()=>batch})}),response=await api({method:'GET',url,headers:{}});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data,batch);
  const unavailable=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'human-controller'}),kernelFactory:()=>({}),aiAccountingDecisionPacketServiceFactory:async()=>({analyze:async()=>{throw Object.assign(new Error('drift'),{code:'AI_ACCOUNTING_SETTINGS_BINDING_INVALID'});}})}),failure=await unavailable({method:'GET',url,headers:{}});assert.equal(failure.status,503);assert.equal(failure.headers['cache-control'],'no-store');assert.equal(failure.body.message,'Internal server error');
});

test('OpenAPI exposes the production full packet batch without granting accounting authority',async()=>{
  const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  const operation=contract.paths['/entities/{entityId}/ai/accounting-decisions'].get;
  const alternatives=operation.responses['200'].content['application/json'].schema.properties.data.oneOf.map(item=>item.$ref);
  assert.deepEqual(alternatives,['#/components/schemas/AiAccountingDecisionPacketFullBatch','#/components/schemas/AiAccountingDecisionPacketBatch']);
  const batch=contract.components.schemas.AiAccountingDecisionPacketFullBatch,packetSchema=contract.components.schemas.AiAccountingDecisionPacketFull;
  assert.equal(batch.additionalProperties,false);assert.equal(batch.properties.schema_version.const,'AI_ACCOUNTING_DECISION_PACKET_FULL_BATCH_V1');
  assert.equal(packetSchema.additionalProperties,false);assert.equal(packetSchema.properties.proposed_journal.properties.status.const,'SUGGESTED_ONLY');
  assert.deepEqual(contract.components.schemas.AiInvoiceNoAccountingActions.required,['can_create_draft','can_review','can_approve','can_post']);
  for(const flag of ['decision_to_draft','decision_to_posted_ledger','decision_to_report'])assert.equal(packetSchema.properties.trace.properties[flag].const,false);
  for(const name of ['AiAccountingDecisionFullSource','AiAccountingDecisionFullRisk','AiAccountingDecisionFullPolicyTrace','AiAccountingDecisionFullWorkflowPolicy','AiAccountingDecisionFullWorkflowStage','AiAccountingDecisionFullAccountPolicy','AiAccountingDecisionFullJournalLine','AiAccountingDecisionFullReportDelta']){const schema=contract.components.schemas[name];assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);assert.ok(schema.required.length>0);assert.ok(Object.keys(schema.properties).length>0);}
  for(const property of ['source','risk','workflow_policy'])assert.match(packetSchema.properties[property].$ref,/^#\/components\/schemas\/AiAccountingDecisionFull/);
  for(const property of ['policy_traces','approved_account_policies','expected_report_deltas'])assert.match(packetSchema.properties[property].items.$ref,/^#\/components\/schemas\/AiAccountingDecisionFull/);
  assert.match(packetSchema.properties.proposed_journal.properties.lines.items.$ref,/AiAccountingDecisionFullJournalLine$/);
  assert.equal(contract.components.schemas.AiAccountingDecisionFullSourceDetail.oneOf.every(schema=>schema.type==='object'&&schema.additionalProperties===false&&Array.isArray(schema.required)&&Object.keys(schema.properties).length>0),true);
});

test('full batch validator rejects unknown status and any decision-count shape or value drift',()=>{
  const safe={schema_version:'AI_ACCOUNTING_DECISION_PACKET_FULL_BATCH_V1',scope:{tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId},row_count:1,decision_counts:{ready_for_human_review:1,exception:0},packets:[packet],action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}};
  assert.equal(assertAiAccountingDecisionPacketFullBatch(safe,{tenantId,entityId,accountingPeriodId:periodId}),safe);
  for(const unsafe of [{...safe,packets:[{...packet,status:'UNKNOWN'}]},{...safe,packets:[{...packet,reason:'Authorization: Bearer abcdefghijklmnop'}]},{...safe,packets:[{...packet,reason:'Retained memo contained rk-abcdefgh12345678'}]},{...safe,decision_counts:{ready_for_human_review:0,exception:1}},{...safe,decision_counts:{ready_for_human_review:1,exception:0,total:1}},{...safe,decision_counts:{ready_for_human_review:1.5,exception:-.5}}])assert.throws(()=>assertAiAccountingDecisionPacketFullBatch(unsafe,{tenantId,entityId,accountingPeriodId:periodId}),error=>error.code==='AI_ACCOUNTING_DECISION_RESPONSE_INVALID');
});
