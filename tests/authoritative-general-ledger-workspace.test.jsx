import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeGeneralLedgerDetail,AuthoritativeGeneralLedgerWorkspace} from '../src/authoritative-general-ledger-workspace.jsx';
import {refreshAuthoritativeGeneralLedger} from '../src/accounting-api.js';

const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',journalId='33333333-3333-4333-8333-333333333333',journalLineId='44444444-4444-4444-8444-444444444444',ledgerLineId='55555555-5555-4555-8555-555555555555',sourceId='66666666-6666-4666-8666-666666666666';
const config={baseUrl:'https://api.example.test',entityId,periodId,getAccessToken:async()=> 'a'.repeat(32)};
const row={period_id:periodId,period_code:'2026-08',period_start:'2026-08-01',period_end:'2026-08-31',account_code:'610000',account_name:'Expense',currency:'USD',journal_date:'2026-08-10',journal_entry_id:journalId,journal_number:'JE-100',journal_line_id:journalLineId,ledger_line_id:ledgerLineId,member_ref:null,description:'Retained invoice',debit_amount:'10.1010',credit_amount:'0.0000',source_document_ids:[sourceId],total_count:1};
test('General Ledger client requires a no-store scoped GET and validates immutable evidence IDs',async()=>{
  let call;const result=await refreshAuthoritativeGeneralLedger({config,query:'JE-100',limit:50,offset:0,fetcher:async(url,options)=>{call={url,options};return new Response(JSON.stringify({ok:true,data:[row]}),{status:200,headers:{'content-type':'application/json'}});}});
  assert.equal(result.ok,true);assert.equal(result.rows[0].debit_amount,'10.1010');assert.equal(result.total,1);assert.match(call.url,/general-ledger\/entries/);assert.equal(new URL(call.url).searchParams.get('periodId'),periodId);assert.equal(call.options.cache,'no-store');assert.equal(call.options.method,'GET');
  const bad=await refreshAuthoritativeGeneralLedger({config,fetcher:async()=>new Response(JSON.stringify({ok:true,data:[{...row,total_count:0}]}),{status:200})});assert.equal(bad.code,'ACCOUNTING_API_PROTOCOL');
});
test('General Ledger workspace is a retained read-only, contained-table surface',()=>{
  const markup=renderToStaticMarkup(<AuthoritativeGeneralLedgerWorkspace config={config} fetcher={async()=>new Response(JSON.stringify({ok:true,data:[]}),{status:200})}/>);
  for(const text of ['GENERAL LEDGER | POSTED EVIDENCE','Apply','Refresh evidence','POSTED ledger lines'])assert.match(markup,new RegExp(text));
  const source=String(AuthoritativeGeneralLedgerWorkspace);for(const text of ['Open evidence','Showing server page','scroll horizontally','ad-hoc date overrides are not supplied'])assert.match(source,new RegExp(text));
  assert.doesNotMatch(markup,/localStorage|seed\.js|>Export<|>Post journal<|>Create journal</i);
});
test('General Ledger line evidence is a full-page immutable snapshot with exact Back context',()=>{
  const markup=renderToStaticMarkup(<AuthoritativeGeneralLedgerDetail row={row} returnContext={{accountCode:'610000',query:'JE-100',page:2}} onBack={()=>{}}/>);
  for(const text of ['Back to General Ledger','GENERAL LEDGER · LINE EVIDENCE','Immutable evidence identifiers','Journal entry ID','Journal line ID','Ledger line ID','Source document IDs','account 610000','search “JE-100”','page 2'])assert.match(markup,new RegExp(text));
  assert.match(markup,new RegExp(ledgerLineId));
  assert.doesNotMatch(markup,/localStorage|seed\.js|>Export<|>Post journal<|>Create journal</i);
});
