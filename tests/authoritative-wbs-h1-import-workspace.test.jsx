import fs from 'node:fs';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeWbsH1ImportWorkspace} from '../src/authoritative-wbs-h1-import-workspace.jsx';
import {refreshAuthoritativeWbsH1ImportInventory,refreshAuthoritativeWbsH1AccountingSettingsProposal,readAuthoritativeWbsH1AccountingSettingsDecision,decideAuthoritativeWbsH1AccountingSettings} from '../src/accounting-api.js';

const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',config={baseUrl:'https://api.example.test',entityId,periodId,getAccessToken:async()=> 'abcdefghijklmnop'};
const counts={source_record_count:1,source_amount:'125.0000',controlled_test_posted_count:0,formal_mapping_posted_count:0,mapping_missing_count:1,mapping_ready_count:0,mapping_ambiguous_count:0};
const data={schema_version:'WBS_H1_IMPORT_INVENTORY_V1',company_code:'SUCF',currency:'USD',date_from:'2026-01-01',date_to:'2026-06-30',limit:50,offset:0,totals:counts,months:Array.from({length:6},(_,index)=>({period_code:`2026-${String(index+1).padStart(2,'0')}`,...counts,source_record_count:index===0?1:0,source_amount:index===0?'125.0000':'0.0000',mapping_missing_count:index===0?1:0})),rows:[{source_record_hash:`sha256:${'a'.repeat(64)}`,accounting_date:'2026-01-15',amount:'125.0000',project_code:null,cost_code:'100',vendor_no:'V-1',import_state:'SOURCE_STAGED',mapping_state:'MAPPING_MISSING'}],source_mode:'REAL_WBS_STAGED',accounting_authority:'NONE',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

const markup=renderToStaticMarkup(<AuthoritativeWbsH1ImportWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(markup,/2026 H1 business data/);assert.match(markup,/Loading WBS business data/);assert.doesNotMatch(markup,/Create Draft|Post journal|localStorage|seed\.js/);

async function verifyClient(){
  let call;const result=await refreshAuthoritativeWbsH1ImportInventory({config,limit:50,offset:0,fetcher:async(url,options)=>{call={url,options};return {ok:true,json:async()=>({ok:true,data})};}});
  assert.equal(result.ok,true);assert.match(call.url,/\/wbs\/h1-import-inventory\?limit=50&offset=0$/);assert.equal(call.options.method,'GET');assert.equal(call.options.cache,'no-store');assert.equal('body' in call.options,false);
  assert.equal((await refreshAuthoritativeWbsH1ImportInventory({config,limit:50,offset:0,fetcher:async()=>({ok:true,json:async()=>({ok:true,data:{...data,can_post:true}})})})).code,'WBS_H1_IMPORT_INVENTORY_PROTOCOL');
  const proposal={schema_version:'WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_V1',status:'READY_FOR_HUMAN_REVIEW',company_code:'SUCF',currency:'USD',period_id:periodId,period_code:'2026-01',period_start:'2026-01-01',period_end:'2026-01-31',source_setting_count:0,ready_rule_count:0,blocked_rule_count:0,exception_count:0,rules:[],source_mode:'REAL_WBS_STAGED',accounting_authority:'NONE',can_create_draft:false,can_review:false,can_approve:false,can_post:false,proposal_hash:`sha256:${'b'.repeat(64)}`};
  const settings=await refreshAuthoritativeWbsH1AccountingSettingsProposal({config,fetcher:async(url,options)=>{call={url,options};return {ok:true,json:async()=>({ok:true,data:proposal})};}});assert.equal(settings.ok,true);assert.match(call.url,new RegExp(`/wbs/h1-accounting-settings-proposal\\?periodId=${periodId}$`));assert.equal(call.options.method,'GET');assert.equal(call.options.cache,'no-store');assert.equal((await refreshAuthoritativeWbsH1AccountingSettingsProposal({config,fetcher:async()=>({ok:true,json:async()=>({ok:true,data:{...proposal,can_post:true}})})})).code,'WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_PROTOCOL');
  const decision={schema_version:'WBS_H1_ACCOUNTING_SETTINGS_HUMAN_DECISION_V1',decision_id:entityId,period_id:periodId,proposal_hash:proposal.proposal_hash,outcome:'APPROVED',decision_hash:`sha256:${'c'.repeat(64)}`,decided_by:'controller',decided_at:'2026-08-22T20:00:00.000Z',approved_rule_count:0,can_create_draft:false,can_review:false,can_approve:false,can_post:false,idempotent:false};
  const read=await readAuthoritativeWbsH1AccountingSettingsDecision({config,proposalHash:proposal.proposal_hash,fetcher:async(url,options)=>{call={url,options};return {ok:true,json:async()=>({ok:true,data:null})};}});assert.equal(read.ok,true);assert.equal(read.data,null);assert.equal(call.options.method,'GET');
  const decided=await decideAuthoritativeWbsH1AccountingSettings({config,proposalHash:proposal.proposal_hash,outcome:'APPROVED',reason:'Controller reviewed the exact WBS rule population.',idempotencyKey:'settings-decision-1',fetcher:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,data:decision})};}});assert.equal(decided.ok,true);assert.equal(call.options.method,'POST');assert.equal(call.options.headers['idempotency-key'],'settings-decision-1');assert.equal(JSON.parse(call.options.body).outcome,'APPROVED');
}

const source=fs.readFileSync('src/authoritative-wbs-h1-import-workspace.jsx','utf8');
for(const copy of ['Imported business data is available','Imported source rows are not formal ledger entries','Controlled test posted','Ready for mapping review','NO ACCOUNTING ACTION','WBS account Settings','Approve Settings','SETTINGS ONLY','never creates or posts a Journal'])assert.match(source,new RegExp(copy));
assert.doesNotMatch(source,/wbs_uuid|Create Draft|Post journal|localStorage|seed\.js/);
verifyClient().then(()=>console.log('authoritative WBS H1 import workspace: real company source inventory remains read only')).catch(error=>{console.error(error);process.exitCode=1;});
