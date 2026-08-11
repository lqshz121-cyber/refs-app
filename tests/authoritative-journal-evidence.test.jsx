import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthoritativeJournalDetail, AuthoritativeJournalTable } from '../src/authoritative-journal-workspace.jsx';

const entityId='11111111-1111-4111-8111-111111111111';
const journal={journal_entry_id:'22222222-2222-4222-8222-222222222222',journal_number:'JE-100',journal_type:'MANUAL',status:'DRAFT',journal_date:'2026-08-01',currency:'USD',description:'Read-only journal evidence',revision:3,created_at:'2026-08-01T00:00:00.000Z',posted_at:null,ledger_line_count:2};
const list=renderToStaticMarkup(<AuthoritativeJournalTable journals={[journal]} onOpen={()=>{}}/>);
assert.match(list,/GENERAL LEDGER/); assert.match(list,/JOURNAL REGISTER/); assert.match(list,/Read only/); assert.match(list,/Currency/); assert.match(list,/Open evidence/); assert.match(list,/JE-100/);
assert.match(list,/In scope/); assert.match(list,/Draft/); assert.match(list,/Needs review/); assert.match(list,/Posted/);
assert.match(list,/value="REVIEW_REQUIRED"/,'the journal review queue must be filterable as the same aggregate counted by its summary card');
assert.match(list,/Memo \/ description/); assert.match(list,/Revision 3/); assert.match(list,/Clear filters/);
assert.match(list,/Journal entry presentation filters/); assert.match(list,/id="authoritative-journal-22222222-2222-4222-8222-222222222222"/);
assert.match(list,/class="table-wrap authoritative-journal-table" tabindex="0" aria-label="Journal entry list; scroll horizontally to view every column"/,
  'the eight-column Journal list must be keyboard-focusable and contained by its own horizontal scroller');
assert.doesNotMatch(list,/>Submit<|>Review<|>Approve<|>Post<|>Reverse</i);

const detail=renderToStaticMarkup(<AuthoritativeJournalDetail journal={journal} entityId={entityId} returnContext={{view:{query:'JE-100',page:2}}} onBack={()=>{}}/>);
assert.match(detail,/Back to Journal entries/); assert.match(detail,/Entity scope retained/); assert.match(detail,/list revision 3/);
assert.match(detail,/query JE-100/); assert.match(detail,/page 2/);
assert.match(detail,/Journal entry JE-100/); assert.match(detail,/Journal evidence scope/); assert.match(detail,/Authoritative lineage unavailable/);
assert.match(detail,/Journal Lines, Ledger Line IDs, Source Document IDs, mapping decisions, or audit events/);
assert.match(detail,/cannot create, edit, submit, review, approve, post, reverse, attach, print, export, or synchronize/);
assert.doesNotMatch(detail,/<input|<select|>Submit<|>Approve<|>Post</i);

const empty=renderToStaticMarkup(<AuthoritativeJournalTable journals={[]} onOpen={()=>{}}/>);
assert.match(empty,/not evidence of zero ledger activity/); assert.doesNotMatch(empty,/<table/);

const app=fs.readFileSync(path.join(process.cwd(),'src','authoritative-app.jsx'),'utf8');
assert.match(app,/AuthoritativeJournalWorkspace/);
assert.doesNotMatch(app,/transitionAuthoritativeJournal|nextAuthoritativeWorkflowAction|Draft entry|route === 'drafts'/);
const workspace=fs.readFileSync(path.join(process.cwd(),'src','authoritative-journal-workspace.jsx'),'utf8');
assert.match(workspace,/restoreAuthoritativeReturnContext/,'Back must restore scroll and focus to the originating evidence control');
assert.match(workspace,/setQueue\('REVIEW_REQUIRED'\)/,'Needs review must include the retained review and approval statuses it counts');
assert.match(workspace,/table-wrap authoritative-journal-table/,'Journal facts must use the shared, page-contained table scroller');
assert.doesNotMatch(workspace,/localStorage|SEED_|legacy-demo|seed\.js|repo\.js/,'authoritative Journal evidence must not read browser accounting state');
const styles=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
assert.match(styles,/\.authoritative-journal-table \.tbl\{min-width:1060px;table-layout:fixed;\}/,
  'the journal evidence columns must scroll inside the table container rather than squeezing or widening the page');

console.log('authoritative-journal-evidence: API-only journal register, full-page evidence, Back/focus, lineage block, and empty-state contracts verified');
