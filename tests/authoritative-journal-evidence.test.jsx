import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthoritativeJournalDetail, AuthoritativeJournalTable } from '../src/authoritative-journal-workspace.jsx';

const entityId='11111111-1111-4111-8111-111111111111';
const journal={journal_entry_id:'22222222-2222-4222-8222-222222222222',journal_number:'JE-100',journal_type:'MANUAL',status:'DRAFT',journal_date:'2026-08-01',currency:'USD',description:'Read-only journal evidence',revision:3,created_at:'2026-08-01T00:00:00.000Z',posted_at:null,ledger_line_count:2};
const openerRefs={current:new Map()};

const list=renderToStaticMarkup(<AuthoritativeJournalTable journals={[journal]} onOpen={()=>{}} openerRefs={openerRefs}/>);
assert.match(list,/Read-only list facts/); assert.match(list,/Currency/); assert.match(list,/Open evidence/); assert.match(list,/JE-100/);
assert.doesNotMatch(list,/>Submit<|>Review<|>Approve<|>Post<|>Reverse</i);

const detail=renderToStaticMarkup(<AuthoritativeJournalDetail journal={journal} entityId={entityId} onBack={()=>{}}/>);
assert.match(detail,/Back to Journal entries/); assert.match(detail,/11111111-1111-4111-8111-111111111111 · list revision 3/);
assert.match(detail,/Blocked — authoritative lineage unavailable/);
assert.match(detail,/Journal Lines, Ledger Line IDs, Source Document IDs, mapping decisions, or audit events/);
assert.match(detail,/cannot create, edit, submit, review, approve, post, reverse, attach, print, export, or synchronize/);
assert.doesNotMatch(detail,/<input|<select|>Submit<|>Approve<|>Post</i);

const empty=renderToStaticMarkup(<AuthoritativeJournalTable journals={[]} onOpen={()=>{}} openerRefs={openerRefs}/>);
assert.match(empty,/not evidence of zero ledger activity/); assert.doesNotMatch(empty,/<table/);

const app=fs.readFileSync(path.join(process.cwd(),'src','authoritative-app.jsx'),'utf8');
assert.match(app,/AuthoritativeJournalWorkspace/);
assert.doesNotMatch(app,/transitionAuthoritativeJournal|nextAuthoritativeWorkflowAction|Draft entry|route === 'drafts'/);
const workspace=fs.readFileSync(path.join(process.cwd(),'src','authoritative-journal-workspace.jsx'),'utf8');
assert.match(workspace,/openerRefs\.current\.get\(restoreId\.current\)\?\.focus\(\)/,'Back must restore focus to the originating evidence control');
assert.doesNotMatch(workspace,/localStorage|SEED_/,'authoritative Journal evidence must not read browser accounting state');

console.log('authoritative-journal-evidence: read-only list, detail, Back/focus, lineage block, and empty-state contracts verified');
