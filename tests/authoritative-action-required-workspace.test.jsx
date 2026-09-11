import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {actionRequiredJournals,AuthoritativeActionRequiredWorkspace} from '../src/authoritative-action-required-workspace.jsx';

const draft={journal_entry_id:'11111111-1111-4111-8111-111111111111',journal_number:'JE-1042',journal_date:'2026-08-31',description:'Accrued utilities',journal_type:'MANUAL',status:'DRAFT',revision:2};
const review={journal_entry_id:'22222222-2222-4222-8222-222222222222',journal_number:'JE-1043',journal_date:'2026-08-31',description:'Property rent cutoff',journal_type:'ADJUSTMENT',status:'PENDING_REVIEW',revision:1};
const posted={journal_entry_id:'33333333-3333-4333-8333-333333333333',journal_number:'JE-1044',journal_date:'2026-08-31',description:'Posted cash entry',journal_type:'SYSTEM',status:'POSTED',revision:4};
const config={entityId:'44444444-4444-4444-8444-444444444444',periodId:'55555555-5555-4555-8555-555555555555',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};

assert.deepEqual(actionRequiredJournals([draft,posted,review]).map(row=>row.journal_number),['JE-1043','JE-1042'],'only actionable Journal states belong in the queue, ordered by workflow urgency');
const markup=renderToStaticMarkup(<AuthoritativeActionRequiredWorkspace journals={[draft,posted,review]} config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
for(const token of ['Action required','HUMAN WORKFLOW','Journal workflow queue','JE-1042','JE-1043','DRAFT','PENDING_REVIEW','Open Journal workflow','Accounting decision queue','Run and retain'])assert.match(markup,new RegExp(token,'i'));
assert.doesNotMatch(markup,/JE-1044|Posted cash entry/,'Posted Journal entries must not appear in the active work queue');
assert.doesNotMatch(markup,/Auto approve|Auto post|Post all|Approve all/i,'the control center must not invent browser-side bulk accounting commands');
const emptyMarkup=renderToStaticMarkup(<AuthoritativeActionRequiredWorkspace journals={[]} config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(emptyMarkup,/No Journal entries are waiting for workflow action/);
assert.match(emptyMarkup,/does not prove that the period is complete or ready to close/);
const source=fs.readFileSync('src/authoritative-action-required-workspace.jsx','utf8');
for(const token of ['AuthoritativeAiAccountingDecisionWorkbench','onOpenJournalWorkflow?.(row)','SERVER-READ PERMISSIONS','DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED'])assert.ok(source.includes(token),`missing ${token}`);
assert.doesNotMatch(source,/localStorage|sessionStorage|Math\.random|Date\.now|transitionAuthoritativeJournal|decideAuthoritativeAiAccountingDecision/i,'the aggregate must delegate all reads and commands to existing authoritative workflows');
console.log('authoritative Action required workspace: real Journal and AI queues retain server-owned workflow authority');
