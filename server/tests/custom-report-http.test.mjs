import assert from 'node:assert/strict';
import test from 'node:test';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333',ledgerId='44444444-4444-4444-8444-444444444444',journalId='55555555-5555-4555-8555-555555555555',lineId='66666666-6666-4666-8666-666666666666',sourceId='77777777-7777-4777-8777-777777777777',hash=`sha256:${'a'.repeat(64)}`;
const report={schema_version:'CUSTOM_REPORT_V1',report_type:'DIMENSION_PNL',tenant_id:tenantId,entity_id:entityId,period_id:periodId,dimension_type:'PROJECT',dimension_ref:'P-001',limit:1,after_account_code:null,next_after_account_code:'5000',population_source:'POSTED_LEDGER',approved_snapshot_hash:null,ledger_evidence_hash:hash,rows:[{account_code:'5000',account_name:'Cost',statement_section:'EXPENSES',display_balance:'10.0000',budget_amount:null,actual_amount:null,variance_amount:null,journal_entry_ids:[journalId],journal_line_ids:[lineId],ledger_line_ids:[ledgerId],source_document_ids:[sourceId],row_hash:hash}],action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}};

test('custom report HTTP route admits only fixed read DTO and validates cross-scope evidence',async()=>{
 const calls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readCustomReport:async args=>(calls.push(args),report)}),url:'http://unused'});
 const base=`/api/v1/entities/${entityId}/reports/custom?reportType=DIMENSION_PNL&periodId=${periodId}&dimensionType=PROJECT&dimensionRef=P-001&limit=1`;
 let response=await api({method:'GET',url:base,body:null,headers:{}});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls[0],{tenantId,entityId,reportType:'DIMENSION_PNL',periodId,dimensionType:'PROJECT',dimensionRef:'P-001',limit:1,afterAccountCode:null});
 for(const request of [
  {method:'GET',url:`/api/v1/entities/${entityId}/reports/custom?reportType=DIMENSION_PNL&periodId=${periodId}&limit=1`,body:null,headers:{}},
  {method:'GET',url:`/api/v1/entities/${entityId}/reports/custom?reportType=SQL&periodId=${periodId}&limit=1`,body:null,headers:{}},
  {method:'GET',url:`/api/v1/entities/${entityId}/reports/custom?reportType=TRIAL_BALANCE&periodId=${periodId}&dimensionType=PROJECT&dimensionRef=P-001&limit=1`,body:null,headers:{}},
  {method:'GET',url:base,body:{unexpected:true},headers:{}}
 ])assert.equal((await api(request)).status,400);
 const invalid=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readCustomReport:async()=>({...report,entity_id:'88888888-8888-4888-8888-888888888888'})})});
 response=await invalid({method:'GET',url:base,body:null,headers:{}});assert.equal(response.status,502);
});
