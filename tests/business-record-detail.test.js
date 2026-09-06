import test from 'node:test';import assert from 'node:assert/strict';
import {readListedBusinessRecordJournal,readRelatedBusinessRecord,readBusinessRecordJournal} from '../src/business-record-detail.js';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',recordId='33333333-3333-4333-8333-333333333333',periodId='44444444-4444-4444-8444-444444444444';

const config={baseUrl:'https://api.example',entityId,periodId:tenantId,getAccessToken:async()=>'a'.repeat(48)};
const response=data=>({ok:true,status:200,json:async()=>({ok:true,data})});
for(const recordKind of ['AP_BILL','AR_INVOICE','AP_VENDOR_CREDIT','AR_CREDIT_MEMO']){
 const document=['AP_BILL','AR_INVOICE'].includes(recordKind),selection={entityId,recordId,recordKind};
 const record={record_id:recordId,record_kind:recordKind,number:'DOC-1',counterparty_ref:'PARTY-1',counterparty_name:document?'Party':null,currency:'USD',accounting_date:'2026-07-15',due_date:null,amount:'9007199254740993.1234',open_balance:document?'1.2345':null,status:document?'OPEN':'POSTED',revision:'2',description:'Source document',source_document_id:null,journal_entry_id:entityId,journal_number:'JE-1',journal_status:'POSTED',journal_revision:'4',period_id:periodId,created_at:'2026-07-15T12:00:00.123456Z'};
 const data={schema_version:'BUSINESS_RECORD_DETAIL_V1',entity_id:entityId,record};

test(recordKind+' list journal verifies the current record before following its journal',async()=>{
 const row={business_document_id:recordId,business_adjustment_id:recordId,revision:2,version:2,currency:'USD',status:record.status,period_id:periodId};
 const args={config:{...config,periodId},row,recordKind};
 const journal={entity_id:entityId,period_id:periodId,journal_entry_id:entityId,journal_number:'JE-1',journal_type:'MANUAL',status:'POSTED',journal_date:'2026-07-15',currency:'USD',description:null,revision:4,created_at:'2026-07-15T01:02:03.123Z',posted_at:'2026-07-15T02:00:00.000Z',lines:[{line_no:1,journal_line_id:tenantId,ledger_line_id:periodId,account_code:'111000',debit_amount:'30.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:null,dimensions:{},source_document_ids:[]},{line_no:2,journal_line_id:recordId,ledger_line_id:entityId,account_code:'291001',debit_amount:'0.0000',credit_amount:'30.0000',member_ref:'PARTY-1',description:null,dimensions:{},source_document_ids:[]}]};
 const calls=[];const result=await readListedBusinessRecordJournal({...args,fetcher:async(url,options)=>{calls.push(url);assert.equal(options.method,'GET');return response(url.includes('/business-records/')?data:journal);}});
 assert.equal(result.ok,true);assert.equal(calls.length,2);assert.ok(calls[0].includes('/business-records/'+recordId+'?recordKind='+recordKind));assert.ok(calls[1].includes('/journal-entries/'+entityId));
 for(const patch of [{revision:'3'},{period_id:tenantId},{status:document?'PAID':'CANCELLED'}]){let reads=0;const result=await readListedBusinessRecordJournal({...args,fetcher:async()=>{reads++;return response({...data,record:{...record,...patch}});}});assert.equal(result.ok,false);assert.equal(reads,1,'changed record cannot trigger a journal read');}
 assert.equal((await readListedBusinessRecordJournal({...args,row:{...row,period_id:tenantId},fetcher:()=>{throw Error('must not fetch');}})).ok,false);
});
test(recordKind+' related link reads a scoped record without scanning lists or losing amount precision',async()=>{
 const row={adjustment_kind:recordKind.startsWith('AP')?'AP_VENDOR_CREDIT':'AR_CREDIT_MEMO',business_document_id:document?recordId:periodId,business_adjustment_id:document?periodId:recordId,currency:'USD'};
 const args={config,row,target:document?'DOCUMENT':'CREDIT'};
 const result=await readRelatedBusinessRecord({...args,fetcher:async(url,options)=>{assert.equal(url,'https://api.example/api/v1/entities/'+entityId+'/business-records/'+recordId+'?recordKind='+recordKind);assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.cache,'no-store');assert.equal(options.headers.authorization,'Bearer '+'a'.repeat(48));return response(data);}});
 assert.equal(result.ok,true);assert.equal(result.record.amount,'9007199254740993.1234');
 for(const patch of [{record_id:periodId},{currency:'EUR'},{amount:1.2345},{record_kind:'AR_REFUND'}])assert.equal((await readRelatedBusinessRecord({...args,fetcher:async()=>response({...data,record:{...record,...patch}})})).ok,false);
 assert.equal((await readRelatedBusinessRecord({...args,target:'INVALID',fetcher:()=>{throw Error('must not fetch');}})).ok,false);
});
}

{
const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333',journalId='44444444-4444-4444-8444-444444444444';
const config={baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>'a'.repeat(48)};
const row={payment_occurrence_id:journalId,business_document_id:documentId,settlement_kind:'AP_PAYMENT',amount:'9007199254740993.1234',currency:'USD',accounting_date:'2026-09-01',period_id:documentId,period_code:'2026-09',status:'POSTED',revision:'1',created_at:'2026-09-01T01:02:03.123456Z',draft_journal_entry_id:journalId,posted_journal_entry_id:journalId,journal_number:'P1',journal_status:'POSTED',journal_revision:'4'};
const creditRow={journal_entry_id:row.posted_journal_entry_id,period_id:row.period_id,journal_revision:row.journal_revision,journal_status:row.journal_status,currency:row.currency};
test('journal drill reads the payment period and rejects a changed revision or foreign period',async()=>{
  const journal={entity_id:entityId,period_id:documentId,journal_entry_id:journalId,journal_number:'P1',journal_type:'MANUAL',status:'POSTED',journal_date:'2026-09-01',currency:'USD',description:null,revision:4,created_at:'2026-09-01T01:02:03.123Z',posted_at:'2026-09-01T02:00:00.000Z',lines:[{line_no:1,journal_line_id:entityId,ledger_line_id:periodId,account_code:'111000',debit_amount:'30.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:null,dimensions:{},source_document_ids:[]},{line_no:2,journal_line_id:documentId,ledger_line_id:journalId,account_code:'291001',debit_amount:'0.0000',credit_amount:'30.0000',member_ref:'VENDOR-1',description:null,dimensions:{},source_document_ids:[]}]};
  const result=await readBusinessRecordJournal({config,record:creditRow,fetcher:async(url)=>{assert.equal(new URL(url).searchParams.get('periodId'),documentId);return response(journal);}});assert.equal(result.ok,true);assert.equal(result.config.periodId,documentId);
  for(const patch of [{revision:5},{period_id:periodId},{currency:'CAD'}])assert.equal((await readBusinessRecordJournal({config,record:creditRow,fetcher:async()=>response({...journal,...patch})})).ok,false);
  assert.equal((await readBusinessRecordJournal({config,record:{...creditRow,journal_entry_id:null},fetcher:async()=>{throw Error('must not fetch');}})).ok,false);
});

}
