import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {validBusinessRecord} from '../runtime/business-record-detail.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',recordId='33333333-3333-4333-8333-333333333333',periodId='44444444-4444-4444-8444-444444444444';
for(const recordKind of ['AP_BILL','AR_INVOICE','AP_VENDOR_CREDIT','AR_CREDIT_MEMO']){
 const document=['AP_BILL','AR_INVOICE'].includes(recordKind),selection={entityId,recordId,recordKind};
 const record={record_id:recordId,record_kind:recordKind,number:'DOC-1',counterparty_ref:'PARTY-1',counterparty_name:document?'Party':null,currency:'USD',accounting_date:'2026-07-15',due_date:null,amount:'9007199254740993.1234',open_balance:document?'1.2345':null,status:document?'OPEN':'POSTED',revision:'2',description:'Source document',source_document_id:null,journal_entry_id:entityId,journal_number:'JE-1',journal_status:'POSTED',journal_revision:'4',period_id:periodId,created_at:'2026-07-15T12:00:00.123456Z'};
 const data={schema_version:'BUSINESS_RECORD_DETAIL_V1',entity_id:entityId,record};
 test(recordKind+' detail preserves exact money and validates scope, dates and journal facts',()=>{
  assert.equal(validBusinessRecord(data,selection),true);
  for(const patch of [{record_id:entityId},{record_kind:'AR_REFUND'},{amount:9007199254740993},{amount:'1.23456'},{amount:'0.0000'},{revision:'9223372036854775808'},{accounting_date:'2026-02-30'},{created_at:'2026-02-30T12:00:00.123456Z'},{journal_entry_id:null},{period_id:null}])assert.equal(validBusinessRecord({...data,record:{...record,...patch}},selection),false);
  assert.equal(validBusinessRecord({...data,entity_id:tenantId},selection),false);
  const draft={...record,status:'DRAFT',journal_entry_id:null,journal_number:null,journal_status:null,journal_revision:null,period_id:document?null:periodId};assert.equal(validBusinessRecord({...data,record:draft},selection),true);
  if(document)assert.equal(validBusinessRecord({...data,record:{...record,open_balance:'9007199254740994.0000'}},selection),true,'debit adjustments can raise balance above original amount');
 });
 test(recordKind+' detail GET rejects spoofed scope, commands and malformed kernel replies',async()=>{
  let returned=data;const calls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readBusinessRecord:async args=>{calls.push(args);return returned;}})});
  const path=`/api/v1/entities/${entityId}/business-records/${recordId}`,query=`?recordKind=${recordKind}`,get=(suffix=query,patch={})=>api({method:'GET',url:path+suffix,headers:{},body:null,...patch});
  const response=await get();assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data.record.amount,record.amount);assert.deepEqual(calls,[{tenantId,...selection}]);
  for(const suffix of ['',query+'&tenantId=spoof',query+'&periodId='+periodId,query+'&recordKind='+recordKind,'?recordKind=AR_REFUND'])assert.equal((await get(suffix)).status,400);
  for(const patch of [{body:{}},{headers:{'if-match':'"1"'}},{headers:{'idempotency-key':'not-command'}}])assert.equal((await get(query,patch)).status,400);
  assert.equal(calls.length,1);returned={...data,record:{...record,record_id:entityId}};assert.equal((await get()).status,500);
 });
}
