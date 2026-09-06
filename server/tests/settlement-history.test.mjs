import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',businessDocumentId='33333333-3333-4333-8333-333333333333',paymentId='44444444-4444-4444-8444-444444444444';
const path=`/api/v1/entities/${entityId}/business-documents/${businessDocumentId}/settlements`;
const row={payment_occurrence_id:paymentId,business_document_id:businessDocumentId,settlement_kind:'AP_PAYMENT',amount:'9007199254740993.1234',currency:'USD',accounting_date:'2026-09-01',period_id:tenantId,period_code:'2026-09',status:'DRAFT',revision:'0',created_at:'2026-09-01T01:02:03.123456Z',draft_journal_entry_id:entityId,posted_journal_entry_id:null,journal_number:'P1',journal_status:'DRAFT',journal_revision:'0'};
const page={schema_version:'DOCUMENT_SETTLEMENT_HISTORY_V1',entity_id:entityId,business_document_id:businessDocumentId,settlement_kind:'AP_PAYMENT',after_id:null,limit:50,rows:[row],next_id:null};
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>kernel});
const get=(api,url=path+'?kind=AP_PAYMENT',patch={})=>api({method:'GET',url,headers:{},body:null,...patch});
test('history derives identity and source from routing and returns no-store exact decimal facts',async()=>{
  let selected;const response=await get(apiFor({readDocumentSettlements:async args=>(selected=args,page)}));
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(selected,{tenantId,entityId,businessDocumentId,settlementKind:'AP_PAYMENT',afterId:null,limit:50});assert.equal(response.body.data.rows[0].amount,row.amount);
});
test('history rejects command inputs, malformed selections, unknown fields and unavailable readers',async()=>{
  let calls=0;const api=apiFor({readDocumentSettlements:async()=>{calls++;return page;}});
  for(const query of ['kind=BAD','kind=AP_PAYMENT&limit=0','kind=AP_PAYMENT&limit=101','kind=AP_PAYMENT&limit=1e1','kind=AP_PAYMENT&afterId=bad','kind=AP_PAYMENT&tenantId='+tenantId])assert.equal((await get(api,path+'?'+query)).status,400);
  for(const patch of [{body:{}},{headers:{'if-match':'"0"'}},{headers:{'idempotency-key':'12345678'}}])assert.equal((await get(api,undefined,patch)).status,400);
  assert.equal(calls,0);assert.equal((await get(apiFor({}))).status,503);
});
test('history rejects scope contamination, duplicate/out-of-order rows and false journal facts',async()=>{
  for(const patch of [{entity_id:tenantId},{business_document_id:tenantId},{next_id:paymentId},{rows:[row,row]},{rows:[{...row,amount:1}]},{rows:[{...row,period_code:'2026-08'}]},{rows:[{...row,journal_revision:null}]},{rows:[{...row,business_document_id:tenantId}]},{rows:[{...row,created_at:'invalid'}]}])assert.equal((await get(apiFor({readDocumentSettlements:async()=>({...page,...patch})}))).status,500);
  const earlier={...row,payment_occurrence_id:businessDocumentId,created_at:'2026-08-31T23:59:59.999999Z'};
  assert.equal((await get(apiFor({readDocumentSettlements:async()=>({...page,rows:[row,earlier]})}))).status,200);
  assert.equal((await get(apiFor({readDocumentSettlements:async()=>({...page,rows:[earlier,row]})}))).status,500);
});

test('an unavailable scoped cursor is a refreshable query error',async()=>{const r=await get(apiFor({readDocumentSettlements:async()=>{throw Object.assign(new Error('cursor missing'),{code:'22023'});}}));assert.equal(r.status,400);assert.equal(r.body.code,'SETTLEMENT_CURSOR_INVALID');});
