import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {buildAiAccountingDecisionPacket} from '../runtime/ai-accounting-decision-packet.mjs';

const tenant='11111111-1111-4111-8111-111111111111',entity='22222222-2222-4222-8222-222222222222',period='33333333-3333-4333-8333-333333333333';
const hash=n=>`sha256:${n.toString(16).padStart(64,'0')}`,actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const source={source_document_id:'44444444-4444-4444-8444-444444444444',source_document_line_id:'55555555-5555-4555-8555-555555555555',source_payload_hash:hash(4),source_line_hash:hash(5),entity_id:entity,accounting_period_id:period,vendor_ref:'VENDOR-1',currency:'USD',amount:'500.0000',project_ref:null,property_ref:'PROPERTY-1'};
const settings={schema_version:'AI_ACCOUNTING_SETTINGS_SNAPSHOT_V1',snapshot_id:'66666666-6666-4666-8666-666666666666',version:1,snapshot_hash:hash(6),status:'APPROVED',entity_id:entity,accounting_period_id:period,currency:'USD',account_mappings:{expense_account_code:'610000',prepaid_asset_account_code:'140000',accrued_liability_account_code:'220000',cwip_account_code:'150000',accounts_payable_account_code:'210000'}};
const classification={schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2',source_document_id:source.source_document_id,source_document_line_id:source.source_document_line_id,source_payload_hash:source.source_payload_hash,source_line_hash:source.source_line_hash,classification:'EXPENSE',reason:'Ordinary current-period service.',confidence:.98,required_human_fields:['controller_conclusion'],rule_id:'AI_ORDINARY_EXPENSE_V1',policy_evidence:null,action_flags:actions};
const packet=buildAiAccountingDecisionPacket({entityId:entity,accountingPeriodId:period,source,classification,settings});
const safe={schema_version:'AI_ACCOUNTING_DECISION_PACKET_BATCH_V1',scope:{tenant_id:tenant,entity_id:entity,accounting_period_id:period},row_count:1,decision_counts:{ready_for_human_review:1,exception:0},packets:[packet],action_flags:actions};

test('accounting decision GET is exact period scoped, no-store, and no-action',async()=>{
  const calls=[],api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:tenant,actorId:'controller'}),kernelFactory:async()=>({}),aiAccountingDecisionPacketServiceFactory:async()=>({analyze:async input=>(calls.push(input),safe)})});
  const url=`/api/v1/entities/${entity}/ai/accounting-decisions?periodId=${period}&limit=25`,response=await api({method:'GET',url});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,safe);assert.deepEqual(calls,[{tenantId:tenant,entityId:entity,accountingPeriodId:period,limit:25}]);
  assert.equal((await api({method:'GET',url,headers:{'Idempotency-Key':'forbidden'}})).body.code,'READ_COMMAND_HEADERS_FORBIDDEN');
  assert.equal((await api({method:'GET',url,body:{}})).body.code,'READ_BODY_FORBIDDEN');
});

test('accounting decision GET rejects authority, trace, and population drift',async()=>{
  for(const unsafe of [{...safe,action_flags:{...actions,can_post:true}},{...safe,packets:[{...packet,trace:{...packet.trace,decision_to_draft:true}}]},{...safe,row_count:2}]){
    const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:tenant,actorId:'controller'}),kernelFactory:async()=>({}),aiAccountingDecisionPacketServiceFactory:async()=>({analyze:async()=>unsafe})});
    const response=await api({method:'GET',url:`/api/v1/entities/${entity}/ai/accounting-decisions?periodId=${period}`});assert.equal(response.status,502);assert.equal(response.body.code,'AI_ACCOUNTING_DECISION_RESPONSE_INVALID');
  }
});

test('OpenAPI closes the settings-bound decision and suggested-only JE contract',async()=>{
  const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8')),operation=contract.paths['/entities/{entityId}/ai/accounting-decisions'].get;
  assert.equal(operation.operationId,'analyzeAiAccountingDecisions');assert.equal(operation.responses['200'].headers['Cache-Control'].schema.const,'no-store');
  const packetSchema=contract.components.schemas.AiAccountingDecisionPacket,journal=contract.components.schemas.AiAccountingSuggestedJournal;
  assert.equal(packetSchema.additionalProperties,false);assert.equal(journal.properties.status.const,'SUGGESTED_ONLY');assert.equal(journal.properties.lines.maxItems,2);
  for(const flag of ['decision_to_draft','decision_to_posted_ledger','decision_to_report'])assert.equal(packetSchema.properties.trace.properties[flag].const,false);
  assert.deepEqual(contract.components.schemas.AiInvoiceNoAccountingActions.required,['can_create_draft','can_review','can_approve','can_post']);
});
