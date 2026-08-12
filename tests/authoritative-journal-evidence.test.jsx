import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthoritativeJournalDetail, AuthoritativeJournalWorkspace, AuthoritativeJournalTable } from '../src/authoritative-journal-workspace.jsx';

const entityId='11111111-1111-4111-8111-111111111111';
const periodId='33333333-3333-4333-8333-333333333333';
const journal={entity_id:entityId,period_id:periodId,journal_entry_id:'22222222-2222-4222-8222-222222222222',journal_number:'JE-100',journal_type:'MANUAL',status:'DRAFT',journal_date:'2026-08-01',currency:'USD',description:'Read-only journal evidence',revision:3,created_at:'2026-08-01T00:00:00.000Z',posted_at:null,ledger_line_count:2,lines:[
  {journal_line_id:'33333333-3333-4333-8333-333333333333',ledger_line_id:null,line_no:1,account_code:'111000',debit_amount:'25.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:'Exact cash line',dimensions:{property:'P-1'},source_document_ids:['55555555-5555-4555-8555-555555555555']},
  {journal_line_id:'66666666-6666-4666-8666-666666666666',ledger_line_id:null,line_no:2,account_code:'291001',debit_amount:'0.0000',credit_amount:'25.0000',member_ref:null,description:'Exact offset line',dimensions:{},source_document_ids:[]},
]};
const list=renderToStaticMarkup(<AuthoritativeJournalTable journals={[journal]} onOpen={()=>{}}/>);
assert.match(list,/authoritative-workbench-shell/,'the authoritative journal list adopts the shared production workbench frame, not the legacy demo shell');
assert.match(list,/Journal workspace structure/);
assert.match(list,/Scoped evidence/);
assert.match(list,/GENERAL LEDGER/); assert.match(list,/JOURNAL REGISTER/); assert.match(list,/Read only/); assert.match(list,/Currency/); assert.match(list,/Open evidence/); assert.match(list,/JE-100/);
assert.match(list,/Entity register/); assert.match(list,/Draft/); assert.match(list,/Needs review/); assert.match(list,/Posted/);
assert.match(list,/value="REVIEW_REQUIRED"/,'the journal review queue must be filterable as the same aggregate counted by its summary card');
assert.match(list,/Memo \/ description/); assert.match(list,/Revision 3/); assert.match(list,/Clear filters/);
assert.match(list,/Journal entry presentation filters/); assert.match(list,/id="authoritative-journal-22222222-2222-4222-8222-222222222222"/);
assert.match(list,/class="table-wrap authoritative-journal-table" tabindex="0" aria-label="Journal entry list; scroll horizontally to view every column"/,
  'the eight-column Journal list must be keyboard-focusable and contained by its own horizontal scroller');
assert.doesNotMatch(list,/>Submit<|>Review<|>Approve<|>Post<|>Reverse</i);

const returnContext={entityId,periodId,journalId:journal.journal_entry_id,journalRevision:journal.revision,journalCurrency:'USD',view:{query:'JE-100',status:'POSTED',from:'2026-08-01',through:'2026-08-31',page:2}};
const detail=renderToStaticMarkup(<AuthoritativeJournalDetail journal={journal} entityId={entityId} returnContext={returnContext} onBack={()=>{}}/>);
assert.match(detail,/authoritative-evidence-page/,'journal detail must use the full-page authoritative evidence frame');
assert.match(detail,/Back to Journal entries/); assert.match(detail,/Entity 11111111-1111-4111-8111-111111111111/); assert.match(detail,/detail period 33333333-3333-4333-8333-333333333333/);assert.match(detail,/authoritative list revision 3/);
assert.match(detail,/search JE-100/); assert.match(detail,/status POSTED/); assert.match(detail,/from 2026-08-01/); assert.match(detail,/through 2026-08-31/); assert.match(detail,/page 2/);
assert.match(detail,/Journal entry JE-100/); assert.match(detail,/Journal evidence scope/); assert.match(detail,/No write or inferred drill authority/);
assert.match(detail,/Journal ID/); assert.match(detail,/22222222-2222-4222-8222-222222222222/);
assert.match(detail,/EXACT API LINE FACTS/);assert.match(detail,/Not posted/);assert.match(detail,/property/);
assert.match(detail,/cannot create, edit, submit, review, approve, post, reverse/);
assert.doesNotMatch(detail,/<input|<select|>Submit<|>Approve<|>Post</i);

const journalWithExactLines={...journal,status:'POSTED',posted_at:'2026-08-01T01:00:00.000Z',lines:[
  {journal_line_id:'33333333-3333-4333-8333-333333333333',ledger_line_id:'44444444-4444-4444-8444-444444444444',line_no:1,account_code:'111000',debit_amount:'25.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:'Exact cash line',dimensions:{property:'P-1'},source_document_ids:['55555555-5555-4555-8555-555555555555']},
  {journal_line_id:'66666666-6666-4666-8666-666666666666',ledger_line_id:'77777777-7777-4777-8777-777777777777',line_no:2,account_code:'291001',debit_amount:'0.0000',credit_amount:'25.0000',member_ref:null,description:'Exact offset line',dimensions:{},source_document_ids:[]},
]};
const exactDetail=renderToStaticMarkup(<AuthoritativeJournalDetail journal={journalWithExactLines} entityId={entityId} returnContext={{...returnContext,view:{}}} onBack={()=>{}}/>);
assert.match(exactDetail,/EXACT API LINE FACTS/);assert.match(exactDetail,/Journal lines/);assert.match(exactDetail,/111000/);assert.match(exactDetail,/25\.0000/);assert.match(exactDetail,/33333333-3333-4333-8333-333333333333/);
assert.match(exactDetail,/class="table-wrap authoritative-journal-line-table" tabindex="0" aria-label="Journal line evidence; scroll horizontally to view every column"/);
assert.doesNotMatch(exactDetail,/immutable Journal scope mismatch/,'an exact API detail matching the frozen context must be shown');

const empty=renderToStaticMarkup(<AuthoritativeJournalTable journals={[]} onOpen={()=>{}}/>);
assert.match(empty,/not evidence of zero ledger activity/); assert.doesNotMatch(empty,/<table/);

const app=fs.readFileSync(path.join(process.cwd(),'src','authoritative-app.jsx'),'utf8');
assert.match(app,/AuthoritativeJournalWorkspace/);
assert.doesNotMatch(app,/transitionAuthoritativeJournal|nextAuthoritativeWorkflowAction|Draft entry|route === 'drafts'/);
const workspace=fs.readFileSync(path.join(process.cwd(),'src','authoritative-journal-workspace.jsx'),'utf8');
const demoJournalView=fs.readFileSync(path.join(process.cwd(),'src','authoritative-demo-journal-view.jsx'),'utf8');
assert.doesNotMatch(demoJournalView,/seed\.js|repo\.js|localStorage|legacy-demo-app|data\.js|accounting-api/,'the journal presentation extraction must receive authoritative facts as slots');
assert.match(list,/demo-journal-presentation/);
assert.match(workspace,/restoreAuthoritativeReturnContext/,'Back must restore scroll and focus to the originating evidence control');
assert.match(workspace,/const journalMatchesReturnContext/);
assert.match(workspace,/context\?\.journalId === journal\.journal_entry_id/);
assert.match(workspace,/context\?\.journalRevision === journal\.revision/);
assert.match(workspace,/BLOCKED — immutable Journal scope mismatch/);
assert.match(workspace,/setQueue\('REVIEW_REQUIRED'\)/,'Needs review must include the retained review and approval statuses it counts');
assert.match(workspace,/table-wrap authoritative-journal-table/,'Journal facts must use the shared, page-contained table scroller');
assert.match(workspace,/readAuthoritativeJournalEntryDetail/,'opening evidence must perform an exact authoritative detail read');
assert.match(workspace,/journalCurrency:journal\.currency/);assert.match(workspace,/context\?\.periodId === journal\.period_id/);
assert.doesNotMatch(workspace,/localStorage|SEED_|legacy-demo|seed\.js|repo\.js/,'authoritative Journal evidence must not read browser accounting state');
const mismatchedDetail=renderToStaticMarkup(<AuthoritativeJournalDetail journal={journal} entityId={entityId} returnContext={{...returnContext,journalId:'22222222-2222-4222-8222-222222222999'}} onBack={()=>{}}/>);
assert.match(mismatchedDetail,/BLOCKED — immutable Journal scope mismatch/);
assert.match(mismatchedDetail,/Back to Journal entries/);
assert.doesNotMatch(mismatchedDetail,/EXACT API LINE FACTS/,'a stale Journal identity must block before line evidence');
const evidenceWorkspace=renderToStaticMarkup(<AuthoritativeJournalWorkspace journals={[journal]} config={{entityId,periodId:'33333333-3333-4333-8333-333333333333'}} environment={{scrollY:0,setTimeout:callback=>callback(),document:{getElementById:()=>null}}}/>);
assert.match(evidenceWorkspace,/GENERAL LEDGER \| JOURNAL REGISTER/);
assert.doesNotMatch(evidenceWorkspace,/\u8def|鈥|路/,'authority Journal workspace must render English-only separators');
assert.doesNotMatch(detail,/\u8def|鈥|路/,'authority Journal detail must render English-only separators');
const styles=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
assert.match(styles,/\.authoritative-journal-table \.tbl\{min-width:1060px;table-layout:fixed;\}/,
  'the journal evidence columns must scroll inside the table container rather than squeezing or widening the page');
assert.match(styles,/\.authoritative-journal-line-table \.tbl\{min-width:1420px;table-layout:fixed;\}/,
  'exact Journal line evidence must remain in a keyboard-focusable local table scroller');

console.log('authoritative-journal-evidence: API-only journal register, full-page evidence, Back/focus, lineage block, and empty-state contracts verified');
