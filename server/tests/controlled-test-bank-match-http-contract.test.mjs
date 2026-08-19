import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const url=`/api/v1/entities/${entityId}/wbs/test-import/bank-match/run`,body={reason:'Create one exact isolated TEST_ONLY Bank Match'};
const result=idempotent=>({status:'CONTROLLED_TEST_BANK_MATCH_ACTIVE',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent,period_id:id(1),bank_account_ref:'WBS_TEST_BANK',bank_source_id:id(2),business_document_id:id(3),payment_amount:'40.0000',currency:'USD',payment_occurrence_id:id(4),journal_entry_id:id(5),journal_line_id:id(6),ledger_line_id:id(7),bank_match_id:id(8),revision:0});

test('routes exact authenticated isolated Bank Match and returns closed no-store evidence',async()=>{
  const calls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({runBankMatch:async args=>(calls.push(args),result(false))})});
  const response=await api({method:'POST',url,headers:{'idempotency-key':'isolated-bank-match-http-001'},body});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:result(false)});
  assert.deepEqual(calls,[{tenantId,entityId,...body,idempotencyKey:'isolated-bank-match-http-001'}]);
  const replay=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({runBankMatch:async()=>result(true)})});
  assert.equal((await replay({method:'POST',url,headers:{'idempotency-key':'isolated-bank-match-http-001'},body})).status,200);
});

test('rejects command drift and unsafe result shapes',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'operator'}),kernelFactory:async()=>({}),wbsTestImportServiceFactory:async()=>({runBankMatch:async()=>({...result(false),extra:true})})});
  assert.equal((await api({method:'POST',url,headers:{'idempotency-key':'isolated-bank-match-http-001'},body:{...body,bankSourceId:id(9)}})).status,400);
  assert.equal((await api({method:'POST',url,headers:{'idempotency-key':'isolated-bank-match-http-001'},body})).status,500);
  assert.equal((await api({method:'POST',url,headers:{},body})).status,400);
});
