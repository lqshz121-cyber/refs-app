import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const path=`/api/v1/entities/${entityId}/ai/findings/unmatched-bank-payments`;
const row={ai_unmatched_bank_payment_finding_id:'11111111-1111-4111-8111-111111111111',bank_source_id:'22222222-2222-4222-8222-222222222222',source_document_id:'33333333-3333-4333-8333-333333333333',source_payload_hash:'sha256:'+'1'.repeat(64),source_document_version:'4',bank_account_ref:'111000-CASH',external_bank_line_id:'bank-line-42',transaction_date:'2026-07-15',currency:'USD',amount:'-100.0000',bank_version:'5',rule_id:'BANK_PAYMENT_UNMATCHED',risk_level:'MEDIUM',confidence:'1.0000',status:'OPEN',current_match_state:'OPEN',reason:'A retained bank payment has no active AP or posted-payment match.',suggested_action:'Compare payment evidence before any matching or accounting action.',suggested_owner:'CONTROLLER',due_date:null,due_date_status:'HUMAN_ASSIGNMENT_REQUIRED',created_at:'2026-08-14T00:00:00Z',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('AI unmatched bank payment findings are authenticated, bounded GET-only evidence',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({listAiUnmatchedBankPaymentFindings:async input=>(seen.push(input),[row])})});
  const response=await api({method:'GET',url:`${path}?limit=25`,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:[row]});assert.deepEqual(seen,[{tenantId,entityId,limit:25}]);
  for(const request of [{method:'GET',url:path,headers:{'idempotency-key':'forbidden'},body:null},{method:'GET',url:`${path}?limit=101`,headers:{},body:null},{method:'GET',url:`${path}?unknown=1`,headers:{},body:null},{method:'GET',url:path,headers:{},body:{}}])assert.equal((await api(request)).status,400);
});

test('AI unmatched bank payment reader fails closed without its repository capability',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,503);assert.equal(response.body.code,'AI_UNMATCHED_BANK_PAYMENT_FINDING_READ_UNAVAILABLE');
});

test('OpenAPI exposes unmatched bank payments as immutable no-action evidence',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/findings/unmatched-bank-payments'].get;assert.equal(operation.operationId,'listPersistedAiUnmatchedBankPaymentFindings');assert.match(operation.description,/cannot alter a bank line/i);
  const schema=contract.components.schemas.AiUnmatchedBankPaymentFinding;assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.rule_id.const,'BANK_PAYMENT_UNMATCHED');assert.deepEqual(schema.properties.current_match_state.enum,['OPEN','MATCHED_AFTER_FINDING']);for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.equal(schema.properties[field].const,false);
});
