import React from 'react';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeLineageDrill,createLineageRequestGuard,journalLineMatchesLedger,readExactAuthoritativeLedgerLine} from '../src/authoritative-lineage-drill.jsx';

const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222';
const journalId='33333333-3333-4333-8333-333333333333',journalLineId='44444444-4444-4444-8444-444444444444',ledgerLineId='55555555-5555-4555-8555-555555555555',sourceId='66666666-6666-4666-8666-666666666666';
const config={entityId,periodId};
const displayConfig={...config,scopePresentation:{entityLabel:'REFS US Staging',periodLabel:'August 2026'}};
const journal={entity_id:entityId,period_id:periodId,journal_entry_id:journalId,journal_number:'JE-100',journal_type:'MANUAL',status:'POSTED',journal_date:'2026-08-01',currency:'USD',revision:4,lines:[{line_no:1,journal_line_id:journalLineId,ledger_line_id:ledgerLineId,account_code:'610000',debit_amount:'25.0000',credit_amount:'0.0000',member_ref:null,description:'Expense',dimensions:{},source_document_ids:[sourceId]}]};
const gl={period_id:periodId,account_code:'610000',account_name:'Expense',currency:'USD',journal_date:'2026-08-01',journal_entry_id:journalId,journal_number:'JE-100',journal_line_id:journalLineId,ledger_line_id:ledgerLineId,member_ref:null,description:'Expense',debit_amount:'25.0000',credit_amount:'0.0000',source_document_ids:[sourceId]};
const source={source_document_id:sourceId,source_document_revision:2,document_no:'BILL-1',source_record_id:'SR-1',accounting_date:'2026-08-01',currency:'USD',payload_hash:`sha256:${'a'.repeat(64)}`,posted_journal_entry_ids:[journalId]};
const report={period_id:periodId,period_code:'2026-08',period_start:'2026-08-01',period_end:'2026-08-31',currency:'USD',statement_type:'INCOME_STATEMENT',statement_section:'EXPENSE',account_code:'610000',account_name:'Expense',period_debit:'25.0000',period_credit:'0.0000',display_balance:'25.0000',journal_entry_ids:[journalId],journal_line_ids:[journalLineId],ledger_line_ids:[ledgerLineId],source_document_ids:[sourceId]};

async function main(){
assert.equal(journalLineMatchesLedger(journal,journal.lines[0],gl),true);
assert.equal(journalLineMatchesLedger(journal,{...journal.lines[0],source_document_ids:[sourceId,'77777777-7777-4777-8777-777777777777']},gl),false,'Journal→GL must reject a source retained only by Journal');
assert.equal(journalLineMatchesLedger(journal,journal.lines[0],{...gl,source_document_ids:[sourceId,'77777777-7777-4777-8777-777777777777']}),false,'GL→Journal must reject a source retained only by GL');
for(const changed of [{account_code:'620000'},{currency:'EUR'},{debit_amount:'24.0000'},{credit_amount:'1.0000'},{debit_amount:'25'}])assert.equal(journalLineMatchesLedger(journal,journal.lines[0],{...gl,...changed}),false,'frozen account, currency, debit and credit MONEY4 must match');
const requestGuard=createLineageRequestGuard();
const failedRead=requestGuard.start();requestGuard.invalidate();
assert.equal(requestGuard.isCurrent(failedRead),false,'returning to current evidence must invalidate the failed request without popping its frame');
const earlierRead=requestGuard.start(),latestRead=requestGuard.start();
assert.equal(requestGuard.isCurrent(earlierRead),false,'a late response cannot replace evidence opened by a newer read');
assert.equal(requestGuard.isCurrent(latestRead),true);
const pagedRows=Array.from({length:405},(_,index)=>({...gl,ledger_line_id:`ledger-${index}`}));pagedRows[377]={...gl,ledger_line_id:ledgerLineId};
const pageCalls=[];
const exactLedger=await readExactAuthoritativeLedgerLine({config,accountCode:'610000',ledgerLineId,readPage:async({limit,offset})=>{pageCalls.push({limit,offset});return {ok:true,rows:pagedRows.slice(offset,offset+limit),total:pagedRows.length};}});
assert.equal(exactLedger.ok,true);assert.equal(exactLedger.row.ledger_line_id,ledgerLineId);assert.deepEqual(pageCalls,[{limit:200,offset:0},{limit:200,offset:200},{limit:200,offset:400}],'lineage must page through the complete bounded account ledger instead of searching only the first 200 rows');
const missingRows=pagedRows.filter(row=>row.ledger_line_id!==ledgerLineId);
const missingLedger=await readExactAuthoritativeLedgerLine({config,accountCode:'610000',ledgerLineId,readPage:async({limit,offset})=>({ok:true,rows:missingRows.slice(offset,offset+limit),total:missingRows.length})});
assert.equal(missingLedger.ok,false);

for(const [kind,value,label] of [['JOURNAL',{journal,context:{entityId,periodId}},'Journal entry JE-100'],['GL',{row:gl,context:{entityId,periodId}},'Posted ledger line'],['SOURCE',{detail:source,context:{entityId,periodId}},'Source Document evidence'],['REPORT',{row:report,context:{entityId,periodId}},'INCOME_STATEMENT account evidence']]){
  const markup=renderToStaticMarkup(<AuthoritativeLineageDrill config={displayConfig} initial={{kind,...value}} onExit={()=>{}}/>);
  assert.match(markup,new RegExp(label));assert.match(markup,/Entity REFS US Staging/);assert.match(markup,/Period August 2026/);assert.doesNotMatch(markup,/>Entity 11111111-1111-4111-8111-111111111111|>Period 22222222-2222-4222-8222-222222222222/);assert.doesNotMatch(markup,/Create|Edit|Post journal|Export/);
}
const fallbackMarkup=renderToStaticMarkup(<AuthoritativeLineageDrill config={config} initial={{kind:'JOURNAL',journal,context:{entityId,periodId}}} onExit={()=>{}}/>);
assert.match(fallbackMarkup,/Entity Configured entity/);assert.match(fallbackMarkup,/Period Configured period/,'missing presentation metadata must remain an honest configured-scope fallback');
const journalMarkup=renderToStaticMarkup(<AuthoritativeLineageDrill config={displayConfig} initial={{kind:'JOURNAL',journal,context:{entityId,periodId}}} onExit={()=>{}}/>);
for(const text of ['Review posted journal lines.','READ ONLY','Journal identifiers','Journal ID','Revision','Currency'])assert.match(journalMarkup,new RegExp(text));
assert.doesNotMatch(journalMarkup,/Exact GET evidence|GET only|state-empty/,'Journal policy must not use implementation copy or the empty-state icon treatment');
assert.match(journalMarkup,new RegExp(journalId));
const sourceCode=readFileSync('src/authoritative-lineage-drill.jsx','utf8');
for(const call of ['readAuthoritativeJournalEntryDetail','readAuthoritativeSourceDocumentDetail','refreshAuthoritativeGeneralLedger','refreshAuthoritativeFinancialStatements'])assert.match(sourceCode,new RegExp(call));
assert.match(sourceCode,/journal\.entity_id===config\.entityId&&journal\.period_id===config\.periodId/);
assert.match(sourceCode,/item\.period_id===config\.periodId&&item\.account_code===row\.account_code&&item\.currency===row\.currency/);
assert.match(sourceCode,/item\.account_code!==row\.account_code\|\|row\.currency&&item\.currency!==row\.currency/,'financial statements without a currency field must still re-read their exact account-scoped ledger line');
assert.match(sourceCode,/The Source Document detail did not retain the exact source-to-Journal relationship/);
assert.match(sourceCode,/BLOCKED - immutable lineage mismatch/);
assert.match(sourceCode,/StateBlock tone="loading" title="Reading evidence"/,'an immutable read must expose a non-interactive announced loading state');
assert.doesNotMatch(sourceCode,/<button[^>]+disabled[^>]*>Reading evidence/,'a pending immutable read must not masquerade as a disabled action');
assert.match(sourceCode,/onClick=\{clearBlocked\}>Back to current evidence/,'a failed read must retain the current evidence frame');
assert.match(sourceCode,/journalLineMatchesLedger\(journal,line,row\)/,'Journal→GL must use the closed symmetric binding');
assert.match(sourceCode,/journalLineMatchesLedger\(journal,line,expected\.ledgerRow\)/,'GL→Journal must use the same closed symmetric binding');
assert.match(sourceCode,/LEDGER_PAGE_SIZE=200,LEDGER_RESULT_CAP=10000/,'report lineage must remain explicitly bounded while paging past the first General Ledger page');
assert.match(sourceCode,/Previous ledger lines/);assert.match(sourceCode,/Next ledger lines/,'large report rows must expose bounded ledger-line pages instead of thousands of buttons at once');
assert.doesNotMatch(sourceCode,/localStorage|seed\.js|legacy-demo-app|POST'|method:\s*'POST'/);
console.log('authoritative lineage drill: exact GET-only source, Journal, GL, and report return chain passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
