import test from 'node:test';
import assert from 'node:assert/strict';
import {readDocumentSettlementHistory,readSettlementJournal} from '../src/document-settlement-history.js';
const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333',journalId='44444444-4444-4444-8444-444444444444';
const config={baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>'a'.repeat(48)};
const row={payment_occurrence_id:journalId,business_document_id:documentId,settlement_kind:'AP_PAYMENT',amount:'9007199254740993.1234',currency:'USD',accounting_date:'2026-09-01',period_id:documentId,period_code:'2026-09',status:'POSTED',revision:'1',created_at:'2026-09-01T01:02:03.123456Z',draft_journal_entry_id:journalId,posted_journal_entry_id:journalId,journal_number:'P1',journal_status:'POSTED',journal_revision:'4'};
const page={schema_version:'DOCUMENT_SETTLEMENT_HISTORY_V1',entity_id:entityId,business_document_id:documentId,settlement_kind:'AP_PAYMENT',after_id:null,limit:25,rows:[row],next_id:null};
const response=data=>({ok:true,status:200,json:async()=>({ok:true,data})});
test('history is an authenticated scoped GET with exact amounts and validated pagination',async()=>{
  const args={config,businessDocumentId:documentId,kind:'AP_PAYMENT'};
  const result=await readDocumentSettlementHistory({...args,fetcher:async(url,options)=>{assert.match(url,/\/settlements\?kind=AP_PAYMENT&limit=25$/);assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.cache,'no-store');assert.equal(options.headers.authorization,'Bearer '+'a'.repeat(48));return response(page);}});assert.equal(result.ok,true);assert.equal(result.data.rows[0].amount,row.amount);
  for(const patch of [{entity_id:periodId},{business_document_id:periodId},{after_id:journalId},{next_id:journalId},{rows:[row,row]}])assert.equal((await readDocumentSettlementHistory({...args,fetcher:async()=>response({...page,...patch})})).ok,false);
});
test('journal drill reads the payment period and rejects a changed revision or foreign period',async()=>{
  const journal={entity_id:entityId,period_id:documentId,journal_entry_id:journalId,journal_number:'P1',journal_type:'MANUAL',status:'POSTED',journal_date:'2026-09-01',currency:'USD',description:null,revision:4,created_at:'2026-09-01T01:02:03.123Z',posted_at:'2026-09-01T02:00:00.000Z',lines:[{line_no:1,journal_line_id:entityId,ledger_line_id:periodId,account_code:'111000',debit_amount:'30.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:null,dimensions:{},source_document_ids:[]},{line_no:2,journal_line_id:documentId,ledger_line_id:journalId,account_code:'291001',debit_amount:'0.0000',credit_amount:'30.0000',member_ref:'VENDOR-1',description:null,dimensions:{},source_document_ids:[]}]};
  const result=await readSettlementJournal({config,row,fetcher:async(url)=>{assert.equal(new URL(url).searchParams.get('periodId'),documentId);return response(journal);}});assert.equal(result.ok,true);assert.equal(result.config.periodId,documentId);
  for(const patch of [{revision:5},{period_id:periodId},{currency:'CAD'}])assert.equal((await readSettlementJournal({config,row,fetcher:async()=>response({...journal,...patch})})).ok,false);
  assert.equal((await readSettlementJournal({config,row:{...row,posted_journal_entry_id:null,draft_journal_entry_id:null},fetcher:async()=>{throw Error('must not fetch');}})).ok,false);
});
