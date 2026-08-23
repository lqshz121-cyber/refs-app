import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { authoritativeScopePresentation, formatAuthoritativeDate } from '../src/authoritative-scope-presentation.js';
import { AuthoritativeJournalDetail, AuthoritativeJournalWorkspace, AuthoritativeJournalTable, nextAuthoritativeJournalWorkflowAction, runAuthoritativeJournalWorkflow } from '../src/authoritative-journal-workspace.jsx';

const entityId='11111111-1111-4111-8111-111111111111';
const periodId='33333333-3333-4333-8333-333333333333';
const readableScope=authoritativeScopePresentation(
  {entityId,periodId,cashAccountCode:'111000'},
  [{period_id:periodId,period_code:'2026-08',period_start:'2026-08-01',period_end:'2026-08-31',account_code:'111000',account_name:'Operating cash'}],
);
assert.equal(readableScope.entityLabel,'Configured entity');
assert.equal(readableScope.entityNameReturned,false);
assert.equal(readableScope.entityHint,'The authenticated API did not return an entity display name.');
assert.equal(readableScope.periodLabel,'2026-08');
assert.equal(readableScope.periodDetail,'Aug 1, 2026 - Aug 31, 2026');
assert.equal(readableScope.periodEnd,'2026-08-31');
assert.equal(readableScope.cashAccountLabel,'111000 - Operating cash');
assert.equal(authoritativeScopePresentation(
  {entityId,periodId,cashAccountCode:'111000'},
  [{entity_id:entityId,period_id:periodId,period_code:'2026-08',period_start:'2026-08-01',period_end:'2026-08-31',account_code:'111000',account_name:'Operating cash',entity_name:'Wan Pacific Real Estate Development LLC'}],
).entityLabel,'Wan Pacific Real Estate Development LLC');
const persistedScope=authoritativeScopePresentation({entityId,periodId,cashAccountCode:'111000'},[],{entity_id:entityId,entity_name:'Wan Pacific Real Estate Development LLC',period_id:periodId,period_code:'2026-08',period_start:'2026-08-01',period_end:'2026-08-31'});
assert.equal(persistedScope.entityLabel,'Wan Pacific Real Estate Development LLC');
assert.equal(persistedScope.periodDetail,'Aug 1, 2026 - Aug 31, 2026');
assert.equal(authoritativeScopePresentation(
  {entityId,periodId,cashAccountCode:'111000'},
  [{entity_id:'99999999-9999-4999-8999-999999999999',account_code:'111000',account_name:'Wrong company cash',entity_name:'Wrong company'}],
).entityLabel,'Configured entity','entity names must not cross company scope');
assert.equal(authoritativeScopePresentation(
  {entityId,periodId:'44444444-4444-4444-8444-444444444444'},
  [],
).periodLabel,'Configured period');
assert.equal(formatAuthoritativeDate('not-a-date'),'Date unavailable');
const journal={entity_id:entityId,period_id:periodId,journal_entry_id:'22222222-2222-4222-8222-222222222222',journal_number:'JE-100',journal_type:'MANUAL',status:'DRAFT',journal_date:'2026-08-01',currency:'USD',description:'Read-only journal evidence',revision:3,created_at:'2026-08-01T00:00:00.000Z',posted_at:null,ledger_line_count:2,lines:[
  {journal_line_id:'33333333-3333-4333-8333-333333333333',ledger_line_id:null,line_no:1,account_code:'111000',debit_amount:'25.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:'Exact cash line',dimensions:{property:'P-1'},source_document_ids:['55555555-5555-4555-8555-555555555555']},
  {journal_line_id:'66666666-6666-4666-8666-666666666666',ledger_line_id:null,line_no:2,account_code:'291001',debit_amount:'0.0000',credit_amount:'25.0000',member_ref:null,description:'Exact offset line',dimensions:{},source_document_ids:[]},
]};
const list=renderToStaticMarkup(<AuthoritativeJournalTable journals={[journal]} onOpen={()=>{}}/>);
assert.match(list,/authoritative-workbench-shell/,'the authoritative journal list adopts the shared production workbench frame, not the legacy demo shell');
assert.doesNotMatch(list,/Journal workspace structure|Scoped evidence|Exact Back/,'the Journal list must not repeat its list/detail/Back hierarchy in a decorative reading rail');
assert.match(list,/GENERAL LEDGER/); assert.match(list,/JOURNAL REGISTER/); assert.match(list,/Read only/); assert.match(list,/Currency/); assert.match(list,/Details/); assert.match(list,/View details/); assert.match(list,/JE-100/);
assert.match(list,/Entity register/); assert.match(list,/Draft/); assert.match(list,/Needs review/); assert.match(list,/Posted/);
assert.match(list,/All entries/); assert.match(list,/Awaiting action/); assert.match(list,/Posted entries/); assert.match(list,/1 result/);
assert.doesNotMatch(list,/All retained journals for this entity|Retained status only|API list status|matching journal entries|Open evidence/,'the Journal first screen must use concise business language without exposing read-model terminology');
const noMatchList=renderToStaticMarkup(<AuthoritativeJournalTable journals={[journal]} view={{query:'No such journal',status:'ALL',from:'',through:'',page:1,pageSize:25}} onOpen={()=>{}}/>);
assert.match(noMatchList,/No journal entries match these filters/);
assert.match(noMatchList,/Try changing or resetting the filters\. This result does not confirm zero ledger activity\./);
assert.doesNotMatch(noMatchList,/match these presentation filters|retained list facts|local no-match/,
  'the Journal no-match state must be actionable without exposing presentation or storage terminology');
assert.match(list,/value="REVIEW_REQUIRED"/,'the journal review queue must be filterable as the same aggregate counted by its summary card');
assert.match(list,/Memo \/ description/); assert.match(list,/Revision 3/); assert.match(list,/Clear filters/);
assert.match(list,/Journal entry presentation filters/); assert.match(list,/id="authoritative-journal-22222222-2222-4222-8222-222222222222"/);
assert.match(list,/class="table-wrap authoritative-journal-table" tabindex="0" aria-label="Journal entry list; scroll horizontally to view every column"/,
  'the eight-column Journal list must be keyboard-focusable and contained by its own horizontal scroller');
assert.doesNotMatch(list,/>Submit<|>Review<|>Approve<|>Post<|>Reverse</i);
const permissions={entity_id:entityId,can_submit:true,can_review:false,can_approve:false,can_post:false};
const actionableList=renderToStaticMarkup(<AuthoritativeJournalTable journals={[journal]} entityId={entityId} capabilities={permissions} onOpen={()=>{}} onWorkflowAction={()=>{}}/>);
assert.match(actionableList,/>Submit</);assert.doesNotMatch(actionableList,/>Review<|>Approve<|>Post</);
assert.equal(nextAuthoritativeJournalWorkflowAction(journal,permissions,entityId).action,'SUBMIT');
assert.equal(nextAuthoritativeJournalWorkflowAction({...journal,status:'PENDING_REVIEW'},permissions,entityId),null,'a status without the exact fixed server capability must have no action');
assert.equal(nextAuthoritativeJournalWorkflowAction(journal,permissions,'99999999-9999-4999-8999-999999999999'),null,'a capability response from another entity must have no action');

const returnContext={entityId,periodId,entityLabel:'Wan Pacific Real Estate Development LLC',periodLabel:'2026-08',journalId:journal.journal_entry_id,journalRevision:journal.revision,journalCurrency:'USD',view:{query:'JE-100',status:'POSTED',from:'2026-08-01',through:'2026-08-31',page:2}};
const detail=renderToStaticMarkup(<AuthoritativeJournalDetail journal={journal} entityId={entityId} returnContext={returnContext} onBack={()=>{}}/>);
assert.match(detail,/authoritative-evidence-page/,'journal detail must use the full-page authoritative evidence frame');
assert.match(detail,/<details class="authoritative-return-context"><summary>List filters retained<\/summary>/,'Journal Back context must remain available without occupying the full Back row');
assert.match(detail,/Back to Journal entries/); assert.match(detail,/Wan Pacific Real Estate Development LLC/); assert.match(detail,/2026-08/); assert.match(detail,/Scope identifiers/); assert.match(detail,/11111111-1111-4111-8111-111111111111/); assert.match(detail,/33333333-3333-4333-8333-333333333333/);assert.match(detail,/authoritative list revision 3/);
assert.match(detail,/search JE-100/); assert.match(detail,/status POSTED/); assert.match(detail,/from Aug 1, 2026/); assert.match(detail,/through Aug 31, 2026/); assert.match(detail,/page 2/);
assert.match(detail,/Journal entry JE-100/); assert.match(detail,/Journal evidence scope/); assert.match(detail,/authoritative-journal-readonly-note/);
assert.match(detail,/Journal ID/); assert.match(detail,/22222222-2222-4222-8222-222222222222/);
assert.match(detail,/JOURNAL ENTRY/);assert.match(detail,/Review journal lines and posting details\./);assert.match(detail,/JOURNAL LINES/);assert.match(detail,/Ordered debit and credit lines\./);assert.match(detail,/2 lines/);assert.doesNotMatch(detail,/EXACT READ EVIDENCE|GET-only facts|EXACT API LINE FACTS|retained lines/);assert.match(detail,/Not posted/);assert.match(detail,/property/);
assert.match(detail,/READ ONLY/);
assert.match(detail,/No editing, workflow, posting, reversing, export, or inferred source links\./);
assert.doesNotMatch(detail,/No write or inferred drill authority|state-block[^>]*tone="blocked"/,'a normal read-only Journal policy must not render as a blocked empty-state card');
assert.doesNotMatch(detail,/<input|<select|>Submit<|>Approve<|>Post</i);

const journalWithExactLines={...journal,status:'POSTED',posted_at:'2026-08-01T01:00:00.000Z',lines:[
  {journal_line_id:'33333333-3333-4333-8333-333333333333',ledger_line_id:'44444444-4444-4444-8444-444444444444',line_no:1,account_code:'111000',debit_amount:'25.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:'Exact cash line',dimensions:{property:'P-1'},source_document_ids:['55555555-5555-4555-8555-555555555555']},
  {journal_line_id:'66666666-6666-4666-8666-666666666666',ledger_line_id:'77777777-7777-4777-8777-777777777777',line_no:2,account_code:'291001',debit_amount:'0.0000',credit_amount:'25.0000',member_ref:null,description:'Exact offset line',dimensions:{},source_document_ids:[]},
]};
const exactDetail=renderToStaticMarkup(<AuthoritativeJournalDetail journal={journalWithExactLines} entityId={entityId} returnContext={{...returnContext,view:{}}} onBack={()=>{}}/>);
assert.match(exactDetail,/JOURNAL LINES/);assert.match(exactDetail,/Journal lines/);assert.match(exactDetail,/111000/);assert.match(exactDetail,/25\.0000/);assert.match(exactDetail,/33333333-3333-4333-8333-333333333333/);
assert.match(exactDetail,/class="table-wrap authoritative-journal-line-table" tabindex="0" aria-label="Journal line evidence; scroll horizontally to view every column"/);
assert.match(exactDetail,/<details class="authoritative-return-context authoritative-journal-line-identifiers"><summary>Audit identifiers<\/summary>/,'Journal line IDs must remain available without widening the default accounting table');
assert.doesNotMatch(exactDetail,/authoritative-journal-line-identifiers"[^>]* open/,'Journal line audit identifiers must remain collapsed by default');
assert.doesNotMatch(exactDetail,/immutable Journal scope mismatch/,'an exact API detail matching the frozen context must be shown');

const empty=renderToStaticMarkup(<AuthoritativeJournalTable journals={[]} onOpen={()=>{}}/>);
assert.match(empty,/INGESTION_BLOCKED/);assert.match(empty,/admit a signed source, complete review, and post/); assert.doesNotMatch(empty,/<table/);

const app=fs.readFileSync(path.join(process.cwd(),'src','authoritative-app.jsx'),'utf8');
assert.match(app,/AuthoritativeJournalWorkspace/);
assert.doesNotMatch(app,/transitionAuthoritativeJournal|nextAuthoritativeWorkflowAction|Draft entry|route === 'drafts'/);
const workspace=fs.readFileSync(path.join(process.cwd(),'src','authoritative-journal-workspace.jsx'),'utf8');
const journalView=fs.readFileSync(path.join(process.cwd(),'src','authoritative-journal-view.jsx'),'utf8');
const styles=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
assert.doesNotMatch(journalView,/seed\.js|repo\.js|localStorage|legacy-demo-app|data\.js|accounting-api/,'the journal presentation extraction must receive authoritative facts as slots');
assert.match(list,/authoritative-journal-presentation/);
assert.match(workspace,/restoreAuthoritativeReturnContext/,'Back must restore scroll and focus to the originating evidence control');
assert.match(workspace,/initialJournalEntryId\?\{\.\.\.DEFAULT_AUTHORITATIVE_LIST_VIEW,query:initialJournalEntryId,status:'DRAFT'\}/,'a WBS Draft handoff must isolate the exact Draft in the standard Journal workflow register');
assert.match(workspace,/closest\('\.table-wrap'\)\?\.scrollLeft/,'Journal evidence actions must freeze their contained table position');
assert.match(workspace,/createAuthoritativeReturnContext\(\{config,view,focusId,scrollY:Number\(environment\?\.scrollY\)\|\|0,tableX\}\)/,'Journal detail must retain table position in the same immutable entity and period context');
assert.match(workspace,/getTable:\(\)=>environment\?\.document\?\.querySelector\?\.\('\.authoritative-journal-table'\)/,'Journal Back must restore the remounted register scroller before returning focus');
assert.equal((workspace.match(/<summary>List filters retained<\/summary>/g)||[]).length,2,'ready and loading Journal detail states must share the compact return-context disclosure');
assert.match(workspace,/const journalMatchesReturnContext/);
assert.match(workspace,/context\?\.journalId === journal\.journal_entry_id/);
assert.match(workspace,/context\?\.journalRevision === journal\.revision/);
assert.match(workspace,/BLOCKED - immutable Journal scope mismatch/);
assert.match(workspace,/setQueue\('REVIEW_REQUIRED'\)/,'Needs review must include the retained review and approval statuses it counts');
assert.match(workspace,/table-wrap authoritative-journal-table/,'Journal facts must use the shared, page-contained table scroller');
assert.match(workspace,/<nav className="pagination"[\s\S]*?className="btn btn-sm btn-ghost"[\s\S]*?Previous[\s\S]*?className="btn btn-sm btn-ghost"[\s\S]*?Next/,'Journal pagination must use the shared button system instead of browser-native controls');
assert.match(styles,/\.pagination\{display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 20px;\}/,'Journal pagination must receive the shared contained layout');
assert.doesNotMatch(workspace,/<dt>Date<\/dt>|<dt>Status<\/dt>|<dt>Revision<\/dt>/,'Journal date, status and revision must not repeat below their scope/header presentation');
assert.match(styles,/\.journal-evidence-scope\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\);/,
  'the five Journal scope facts must remain on one desktop row instead of orphaning Journal date');
assert.match(styles,/\.journal-evidence-scope\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/,
  'Journal scope facts must keep the existing two-column tablet fallback');
assert.match(styles,/@media \(max-width:600px\)\{\.authoritative-journal-summary\{display:flex;gap:8px;overflow-x:auto;/,
  'phone widths must keep Journal queue counts in one compact horizontally browsable status strip');
assert.match(styles,/\.authoritative-journal-summary \.journal-summary-card\{flex:0 0 150px;min-height:84px;/,
  'mobile Journal queue cards must remain readable without filling four vertical screens');
assert.doesNotMatch(styles,/@media \(max-width:600px\)\{\.authoritative-journal-summary,\.journal-evidence-scope\{grid-template-columns:minmax\(0,1fr\);\}/,
  'mobile Journal queues must never regress to four single-column cards');
assert.match(workspace,/readAuthoritativeJournalEntryDetail/,'opening evidence must perform an exact authoritative detail read');
assert.match(workspace,/journalCurrency:journal\.currency/);assert.match(workspace,/context\?\.periodId === journal\.period_id/);
assert.match(workspace,/entityLabel:config\?\.scopePresentation\?\.entityLabel/,'loading and blocked Journal detail states must freeze the same readable company label as the ready drill');
assert.doesNotMatch(workspace,/localStorage|SEED_|legacy-demo|seed\.js|repo\.js/,'authoritative Journal evidence must not read browser accounting state');
const mismatchedDetail=renderToStaticMarkup(<AuthoritativeJournalDetail journal={journal} entityId={entityId} returnContext={{...returnContext,journalId:'22222222-2222-4222-8222-222222222999'}} onBack={()=>{}}/>);
assert.match(mismatchedDetail,/BLOCKED - immutable Journal scope mismatch/);
assert.match(mismatchedDetail,/Back to Journal entries/);
assert.doesNotMatch(mismatchedDetail,/JOURNAL LINES/,'a stale Journal identity must block before line evidence');
const evidenceWorkspace=renderToStaticMarkup(<AuthoritativeJournalWorkspace journals={[journal]} config={{entityId,periodId:'33333333-3333-4333-8333-333333333333'}} environment={{scrollY:0,setTimeout:callback=>callback(),document:{getElementById:()=>null}}}/>);
assert.match(evidenceWorkspace,/GENERAL LEDGER \| JOURNAL REGISTER/);
assert.doesNotMatch(evidenceWorkspace,/\u8def|鈥|路/,'authority Journal workspace must render English-only separators');
assert.doesNotMatch(detail,/\u8def|鈥|路/,'authority Journal detail must render English-only separators');
assert.match(styles,/\.authoritative-journal-table \.tbl\{min-width:1060px;table-layout:fixed;\}/,
  'the journal evidence columns must scroll inside the table container rather than squeezing or widening the page');
assert.match(styles,/\.authoritative-journal-line-table \.tbl\{min-width:980px;table-layout:fixed;\}/,
  'core Journal line facts must remain in a keyboard-focusable local table scroller without permanent UUID columns');
assert.match(styles,/\.authoritative-journal-line-id-item\{display:grid;grid-template-columns:70px repeat\(3,minmax\(0,1fr\)\);/,
  'the closed audit disclosure must retain every immutable line identifier in a readable evidence grid');

async function verifyJournalWorkflow(){
  let workflowCalls=[];
  const workflowFetcher=async(url,options)=>{workflowCalls.push({url,options});if(url.endsWith('/journal-workflow/capabilities'))return {ok:true,json:async()=>({ok:true,data:permissions})};if(url.includes('/transitions/submit'))return {ok:true,status:201,json:async()=>({ok:true,data:{status:'PENDING_REVIEW',revision:4}})};const data=[{...journal,status:'PENDING_REVIEW',revision:'4'}];return {ok:true,json:async()=>({ok:true,data,scope:{entity_id:entityId,period_id:periodId,period_start:'2026-08-01',period_end:'2026-08-31',period_status:'OPEN',total_count:1,limit:200,offset:0}})};};
  const cancelled=await runAuthoritativeJournalWorkflow({journal,config:{baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>('x'.repeat(24))},fetcher:workflowFetcher,environment:{confirm:()=>false}});
  assert.equal(cancelled.cancelled,true);assert.equal(workflowCalls.length,1,'cancelling after a fresh capability read must not dispatch a workflow command');
  workflowCalls=[];const completed=await runAuthoritativeJournalWorkflow({journal,config:{baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>('x'.repeat(24))},fetcher:workflowFetcher,environment:{confirm:()=>true}});
  assert.equal(completed.ok,true);assert.equal(completed.action,'SUBMIT');assert.equal(workflowCalls.length,3);assert.match(workflowCalls[1].url,/\/transitions\/submit$/);assert.equal(workflowCalls[1].options.headers['if-match'],'"3"');assert.equal(workflowCalls[1].options.headers['idempotency-key'],`UI-JE-${journal.journal_entry_id}-3-SUBMIT`);assert.match(workflowCalls[2].url,/\/journal-entries\?periodId=/);
  const refreshFailed=await runAuthoritativeJournalWorkflow({journal,config:{baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>('x'.repeat(24))},fetcher:async(url)=>{if(url.endsWith('/journal-workflow/capabilities'))return {ok:true,json:async()=>({ok:true,data:permissions})};if(url.includes('/transitions/submit'))return {ok:true,status:201,json:async()=>({ok:true,data:{status:'PENDING_REVIEW',revision:4}})};return {ok:false,status:503,json:async()=>({ok:false})};},environment:{confirm:()=>true}});
  assert.equal(refreshFailed.commandCommitted,true);assert.equal(refreshFailed.code,'JOURNAL_WORKFLOW_REFRESH_REQUIRED');
  console.log('authoritative-journal-evidence: API-only journal register, full-page evidence, Back/focus, lineage block, and workflow capability contracts verified');
}
verifyJournalWorkflow().catch(error=>{console.error(error);process.exitCode=1;});
