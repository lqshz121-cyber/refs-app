import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeUnitTransferWorkspace,UnitTransferReversalPanel,currentUnitTransferEliminationProfit} from '../src/authoritative-unit-transfer-workspace.jsx';

const markup=renderToStaticMarkup(<AuthoritativeUnitTransferWorkspace config={{baseUrl:'https://fixture.example',tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'}}/>);
assert.match(markup,/Unit Transfer/);
assert.match(markup,/Loading Unit Transfers/);

assert.equal(currentUnitTransferEliminationProfit([
 {elimination_basis:{intercompany_profit:'25.0000'},reversal_history:[]},
 {elimination_basis:{intercompany_profit:'10.0000'},reversal_history:[{status:'APPROVED_PAIR'}]},
 {elimination_basis:{intercompany_profit:'7.5000'},reversal_history:[{status:'CANCELLED_PAIR'},{status:'POSTED_PAIR'}]},
]),'35.0000','current elimination profit must exclude a Posted reversal while retaining its history');

const source=fs.readFileSync('src/authoritative-unit-transfer-workspace.jsx','utf8');
for(const label of ['Paired reversal history','Active reversal workflow','Create both reversal Draft Journals','Submit reversal Journals','Review reversal Journals','Approve reversal Journals','Reject reversal Journals','Cancel reversal Drafts','Post reversal Journals','Reversal unavailable','Reversal posted'])assert.match(source,new RegExp(label));
assert.match(source,/detail\.action_flags\.can_reverse/,'the create panel must use the backend reversal action flag');
assert.match(source,/reversal\.action_flags\.can_post/,'the reversal lifecycle must use nested backend action flags');
assert.match(source,/row\.reversal_history\?\.some\(attempt=>attempt\.status==='POSTED_PAIR'\)/,'the current elimination summary must scan complete Posted reversal history');
assert.match(source,/detail\.active_reversal/,'the workflow must use only the backend-selected active attempt');
assert.match(source,/history\.map\(attempt=>/,'cancelled attempts must remain visible when a new Draft is allowed');
const createCall=/createAuthoritativeUnitTransferReversal\(\{([^}]*)\}\)/.exec(source);assert.ok(createCall,'the UI must call the paired reversal client');
assert.doesNotMatch(createCall[1],/amount|account|period|journal_lines|lines:/i,'the reversal UI must not submit derived accounting amounts, accounts, periods, or lines');

const flags=patch=>({can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_reject:false,can_cancel:false,can_post:false,can_reverse:false,...patch});
const attempt=patch=>({unit_transfer_reversal_pair_id:'44444444-4444-4444-8444-444444444444',source_period_id:'55555555-5555-4555-8555-555555555555',target_period_id:'66666666-6666-4666-8666-666666666666',reversal_date:'2026-10-01',source_journal_entry_id:'77777777-7777-4777-8777-777777777777',source_journal_status:'DRAFT',source_journal_revision:'0',target_journal_entry_id:'88888888-8888-4888-8888-888888888888',target_journal_status:'DRAFT',target_journal_revision:'0',status:'DRAFT_PAIR',revision:'0',evidence_hash:`sha256:${'a'.repeat(64)}`,created_by:'maker',created_at:'2026-10-01T00:00:00.000Z',completed_at:null,cancelled_by:null,cancelled_at:null,cancel_reason:null,elimination_reversal_basis:null,action_flags:flags({can_submit:true,can_cancel:true}),...patch});
const panel=detail=>renderToStaticMarkup(<UnitTransferReversalPanel detail={detail} reversalDate="2026-10-03" setReversalDate={()=>{}} sourceNumber="RS-2" setSourceNumber={()=>{}} targetNumber="RT-2" setTargetNumber={()=>{}} reason="Retained independent review evidence." setReason={()=>{}} busy={false} onCreate={()=>{}} onCommand={()=>{}}/>);
const cancelled=attempt({status:'CANCELLED_PAIR',revision:'1',cancelled_by:'reviewer',cancelled_at:'2026-10-02T00:00:00.000Z',cancel_reason:'Cancelled after independent evidence review.',action_flags:flags()});
const retryMarkup=panel({reversal_history:[cancelled],active_reversal:null,action_flags:flags({can_reverse:true})});assert.match(retryMarkup,/Cancelled after independent evidence review/);assert.match(retryMarkup,/Create both reversal Draft Journals/,'a cancelled attempt stays visible while a new backend-authorized Draft can be created');
const draft=attempt({created_at:'2026-10-03T00:00:00.000Z'}),activeMarkup=panel({reversal_history:[cancelled,draft],active_reversal:draft,action_flags:flags()});assert.match(activeMarkup,/Active reversal workflow/);assert.match(activeMarkup,/Submit reversal Journals/);assert.doesNotMatch(activeMarkup,/Create both reversal Draft Journals/,'only one active reversal may be operated');
const posted=attempt({status:'POSTED_PAIR',revision:'4',source_journal_status:'POSTED',target_journal_status:'POSTED',completed_at:'2026-10-04T00:00:00.000Z',action_flags:flags(),elimination_reversal_basis:{elimination_reversal_basis_id:'99999999-9999-4999-8999-999999999999',original_elimination_basis_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',evidence_hash:`sha256:${'b'.repeat(64)}`}}),postedMarkup=panel({reversal_history:[posted],active_reversal:null,action_flags:flags()});assert.match(postedMarkup,/Reversal posted/);assert.doesNotMatch(postedMarkup,/Create both reversal Draft Journals/);

console.log('Unit Transfer reversal workspace authority boundaries passed');
