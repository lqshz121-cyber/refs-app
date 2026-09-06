import test from 'node:test';import assert from 'node:assert/strict';
import {readCreditAllocationHistory,readCreditAllocationJournal} from '../src/credit-allocation-history.js';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',creditId='33333333-3333-4333-8333-333333333333',documentId='44444444-4444-4444-8444-444444444444',allocationId='55555555-5555-4555-8555-555555555555';

const config={baseUrl:'https://api.example',entityId,periodId:tenantId,getAccessToken:async()=>'a'.repeat(48)};
const response=data=>({ok:true,status:200,json:async()=>({ok:true,data})});
for(const subjectKind of ['AP_VENDOR_CREDIT','AR_CREDIT_MEMO','AP_BILL','AR_INVOICE']){
 const credit=subjectKind.includes('CREDIT'),subjectId=credit?creditId:documentId;
 const selection={entityId,subjectId,subjectKind,afterId:null,limit:1};
 const row={business_allocation_id:allocationId,business_adjustment_id:creditId,adjustment_kind:subjectKind.startsWith('AP')?'AP_VENDOR_CREDIT':'AR_CREDIT_MEMO',credit_number:'CR-1',business_document_id:documentId,document_number:'DOC-1',amount:'1.2345',currency:'USD',status:'ACTIVE',revision:'0',created_at:'2026-08-01T12:00:00.123456Z',reversed_by_allocation_id:null,journal_entry_id:entityId,journal_number:'JE-1',journal_status:'POSTED',journal_revision:'4',journal_period_id:tenantId};
 const data={schema_version:'CREDIT_ALLOCATION_HISTORY_V1',entity_id:entityId,subject_id:subjectId,subject_kind:subjectKind,after_id:null,limit:1,rows:[row],next_id:allocationId};

 test(subjectKind+' client binds exact history and rejects foreign scopes',async()=>{
 const args={config,subjectId,kind:subjectKind,limit:1};
 const result=await readCreditAllocationHistory({...args,fetcher:async(url,options)=>{assert.match(url,credit?/business-adjustments/:/business-documents/);assert.equal(new URL(url).searchParams.get('subjectKind'),subjectKind);assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.cache,'no-store');assert.equal(options.headers.authorization,'Bearer '+'a'.repeat(48));return response(data);}});assert.equal(result.ok,true);assert.equal(result.data.rows[0].amount,'1.2345');
 for(const patch of [{entity_id:tenantId},{subject_id:entityId},{rows:[{...row,amount:1.2345}]},{after_id:allocationId}])assert.equal((await readCreditAllocationHistory({...args,fetcher:async()=>response({...data,...patch})})).ok,false);
 assert.equal((await readCreditAllocationJournal({config,row:{...row,journal_entry_id:null},fetcher:()=>{throw Error('must not fetch');}})).ok,false);
 });
}

{
const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333',journalId='44444444-4444-4444-8444-444444444444';
const config={baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>'a'.repeat(48)};
const row={payment_occurrence_id:journalId,business_document_id:documentId,settlement_kind:'AP_PAYMENT',amount:'9007199254740993.1234',currency:'USD',accounting_date:'2026-09-01',period_id:documentId,period_code:'2026-09',status:'POSTED',revision:'1',created_at:'2026-09-01T01:02:03.123456Z',draft_journal_entry_id:journalId,posted_journal_entry_id:journalId,journal_number:'P1',journal_status:'POSTED',journal_revision:'4'};
const creditRow={journal_entry_id:row.posted_journal_entry_id,journal_period_id:row.period_id,journal_revision:row.journal_revision,journal_status:row.journal_status,currency:row.currency};
test('journal drill reads the payment period and rejects a changed revision or foreign period',async()=>{
  const journal={entity_id:entityId,period_id:documentId,journal_entry_id:journalId,journal_number:'P1',journal_type:'MANUAL',status:'POSTED',journal_date:'2026-09-01',currency:'USD',description:null,revision:4,created_at:'2026-09-01T01:02:03.123Z',posted_at:'2026-09-01T02:00:00.000Z',lines:[{line_no:1,journal_line_id:entityId,ledger_line_id:periodId,account_code:'111000',debit_amount:'30.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:null,dimensions:{},source_document_ids:[]},{line_no:2,journal_line_id:documentId,ledger_line_id:journalId,account_code:'291001',debit_amount:'0.0000',credit_amount:'30.0000',member_ref:'VENDOR-1',description:null,dimensions:{},source_document_ids:[]}]};
  const result=await readCreditAllocationJournal({config,row:creditRow,fetcher:async(url)=>{assert.equal(new URL(url).searchParams.get('periodId'),documentId);return response(journal);}});assert.equal(result.ok,true);assert.equal(result.config.periodId,documentId);
  for(const patch of [{revision:5},{period_id:periodId},{currency:'CAD'}])assert.equal((await readCreditAllocationJournal({config,row:creditRow,fetcher:async()=>response({...journal,...patch})})).ok,false);
  assert.equal((await readCreditAllocationJournal({config,row:{...creditRow,journal_entry_id:null},fetcher:async()=>{throw Error('must not fetch');}})).ok,false);
});

}
