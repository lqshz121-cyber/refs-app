import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {validCreditHistory} from '../runtime/credit-allocation-history.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',creditId='33333333-3333-4333-8333-333333333333',documentId='44444444-4444-4444-8444-444444444444',allocationId='55555555-5555-4555-8555-555555555555';
for(const subjectKind of ['AP_VENDOR_CREDIT','AR_CREDIT_MEMO','AP_BILL','AR_INVOICE']){
 const credit=subjectKind.includes('CREDIT'),subjectId=credit?creditId:documentId;
 const selection={entityId,subjectId,subjectKind,afterId:null,limit:1};
 const row={business_allocation_id:allocationId,business_adjustment_id:creditId,adjustment_kind:subjectKind.startsWith('AP')?'AP_VENDOR_CREDIT':'AR_CREDIT_MEMO',credit_number:'CR-1',business_document_id:documentId,document_number:'DOC-1',amount:'1.2345',currency:'USD',status:'ACTIVE',revision:'0',created_at:'2026-08-01T12:00:00.123456Z',reversed_by_allocation_id:null,journal_entry_id:entityId,journal_number:'JE-1',journal_status:'POSTED',journal_revision:'4',journal_period_id:tenantId};
 const data={schema_version:'CREDIT_ALLOCATION_HISTORY_V1',entity_id:entityId,subject_id:subjectId,subject_kind:subjectKind,after_id:null,limit:1,rows:[row],next_id:allocationId};
 test(subjectKind+' history validates subject, source posting, precise amount and ordered pages',()=>{
  assert.equal(validCreditHistory(data,selection),true);
  for(const patch of [{amount:1.2345},{amount:'0.0000'},{amount:'1.23456'},{journal_status:'DRAFT'},{journal_entry_id:null},{created_at:'2026-02-30T12:00:00.123456Z'},{revision:'9223372036854775808'},{[credit?'business_adjustment_id':'business_document_id']:entityId},{adjustment_kind:'AR_REFUND'}])assert.equal(validCreditHistory({...data,rows:[{...row,...patch}]},selection),false);
  for(const patch of [{entity_id:tenantId},{subject_id:entityId},{rows:[row,row]},{next_id:entityId}])assert.equal(validCreditHistory({...data,...patch},selection),false);
  assert.equal(validCreditHistory({...data,rows:[],next_id:null},selection),true);
  assert.equal(validCreditHistory({...data,rows:[{...row,status:'REVERSED',reversed_by_allocation_id:documentId}]},selection),true);
  const pending={...row,status:'PENDING',journal_entry_id:null,journal_number:null,journal_status:null,journal_revision:null,journal_period_id:null};assert.equal(validCreditHistory({...data,rows:[pending]},selection),true);
 });
 test(subjectKind+' history GET rejects body, spoofed scope, duplicate filters and malformed kernel result',async()=>{
  const calls=[];let returned=data;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readCreditAllocationHistory:async args=>{calls.push(args);return returned;}})});
  const path=`/api/v1/entities/${entityId}/${credit?'business-adjustments':'business-documents'}/${subjectId}/credit-allocations`,query=`?subjectKind=${subjectKind}&limit=1`;
  const get=(suffix=query,patch={})=>api({method:'GET',url:path+suffix,headers:{},body:null,...patch});
  const result=await get();assert.equal(result.status,200);assert.equal(result.headers['cache-control'],'no-store');assert.deepEqual(calls,[{tenantId,...selection}]);
  for(const suffix of ['',query+'&tenantId=spoof',query+'&limit=2',query+'&afterId=bad',query.replace('limit=1','limit=1e1'),query.replace(subjectKind,credit?'AP_BILL':'AP_VENDOR_CREDIT')])assert.equal((await get(suffix)).status,400);
  for(const patch of [{body:{}},{headers:{'idempotency-key':'forbidden'}},{headers:{'if-match':'"1"'}}])assert.equal((await get(query,patch)).status,400);
  assert.equal(calls.length,1);returned={...data,rows:[{...row,amount:1.2345}]};assert.equal((await get()).status,500);
 });
}
