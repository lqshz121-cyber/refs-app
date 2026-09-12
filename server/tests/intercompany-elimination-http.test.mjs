import assert from 'node:assert/strict';
import test from 'node:test';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {intercompanyEliminationBatch,intercompanyEliminationSource} from './helpers/intercompany-elimination-fixture.mjs';

const reason='Retain the exact reciprocal balance evidence for independent review.';
const transitionReceipt=(draft,{idempotent=false}={})=>({...draft,status:'PENDING_REVIEW',revision:'1',submitted_by:'maker',submitted_at:'2026-09-12T00:01:00Z',history:[...draft.history,{from_status:'DRAFT',to_status:'PENDING_REVIEW',revision:'1',actor_id:'maker',reason,event_hash:`sha256:${'3'.repeat(64)}`,created_at:'2026-09-12T00:01:00Z'}],idempotent});
const cancelReceipt=draft=>({...draft,status:'CANCELLED',revision:'1',source_current:false,cancelled_by:'canceller',cancelled_at:'2026-09-12T00:02:00Z',cancel_reason:reason,history:[...draft.history,{from_status:'DRAFT',to_status:'CANCELLED',revision:'1',actor_id:'canceller',reason,event_hash:`sha256:${'4'.repeat(64)}`,created_at:'2026-09-12T00:02:00Z'}],idempotent:false});

function setup(overrides={}){
 const calls=[],draft=intercompanyEliminationBatch(),source=intercompanyEliminationSource();
 Object.assign(source,{reporting_entity_id:draft.reporting_entity_id,reporting_period_id:draft.reporting_period_id,reporting_period_version:draft.reporting_period_version,reporting_period_start:draft.period_start,reporting_period_end:draft.period_end,period_cutoff:draft.period_end,consolidation_snapshot_id:draft.consolidation_snapshot_id,consolidation_version:draft.consolidation_version,consolidation_snapshot_hash:draft.consolidation_snapshot_hash,consolidation_receipt_hash:draft.consolidation_receipt_hash,consolidation_member_population_hash:draft.consolidation_member_population_hash,consolidation_account_map_population_hash:draft.consolidation_account_map_population_hash,group_ref:draft.group_ref,currency:draft.currency,source_entity_id:draft.source_entity_id,source_period_id:draft.source_period_id,source_period_version:draft.source_period_version,source_account_code:draft.source_account_code,source_closing_balance:draft.source_closing_balance,source_mapping_snapshot_id:draft.source_mapping_snapshot_id,source_mapping_snapshot_hash:draft.source_mapping_snapshot_hash,source_journal_entry_ids:draft.source_journal_entry_ids,source_journal_line_ids:draft.source_journal_line_ids,source_ledger_line_ids:draft.source_ledger_line_ids,source_document_ids:draft.source_document_ids,counterparty_entity_id:draft.counterparty_entity_id,counterparty_period_id:draft.counterparty_period_id,counterparty_period_version:draft.counterparty_period_version,counterparty_account_code:draft.counterparty_account_code,counterparty_closing_balance:draft.counterparty_closing_balance,counterparty_mapping_snapshot_id:draft.counterparty_mapping_snapshot_id,counterparty_mapping_snapshot_hash:draft.counterparty_mapping_snapshot_hash,counterparty_journal_entry_ids:draft.counterparty_journal_entry_ids,counterparty_journal_line_ids:draft.counterparty_journal_line_ids,counterparty_ledger_line_ids:draft.counterparty_ledger_line_ids,counterparty_source_document_ids:draft.counterparty_source_document_ids,source_presentation_account_code:draft.source_presentation_account_code,source_presentation_side:draft.source_presentation_side,source_consolidation_mapping_hash:draft.source_consolidation_mapping_hash,counterparty_presentation_account_code:draft.counterparty_presentation_account_code,counterparty_presentation_side:draft.counterparty_presentation_side,counterparty_consolidation_mapping_hash:draft.counterparty_consolidation_mapping_hash,matched_amount:draft.matched_amount,raw_mismatch:draft.raw_mismatch,canonical_source_scope_hash:draft.canonical_source_scope_hash,source_evidence_hash:draft.source_evidence_hash});
 const options={schema_version:'INTERCOMPANY_ELIMINATION_CREATE_OPTIONS_V1',reporting_entity_id:draft.reporting_entity_id,reporting_period_id:draft.reporting_period_id,group_ref:draft.group_ref,source_entity_id:draft.source_entity_id,source_period_id:draft.source_period_id,counterparty_entity_id:draft.counterparty_entity_id,counterparty_period_id:draft.counterparty_period_id,consolidation_snapshot_id:draft.consolidation_snapshot_id,currency:draft.currency,options:[source],action_flags:{can_create_draft:true,can_submit:false,can_review:false,can_approve:false,can_cancel:false,can_post:false}};
 const kernel={
  readIntercompanyEliminationRegister:async args=>(calls.push(['register',args]),{schema_version:'INTERCOMPANY_ELIMINATION_REGISTER_V1',reporting_entity_id:draft.reporting_entity_id,reporting_period_id:draft.reporting_period_id,rows:[draft],limit:args.limit,action_flags:{can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_cancel:false,can_post:false}}),
  readIntercompanyEliminationCreateOptions:async args=>(calls.push(['options',args]),options),
  readIntercompanyEliminationBatch:async args=>(calls.push(['batch',args]),draft),
  createIntercompanyElimination:async args=>(calls.push(['create',args]),draft),
  transitionIntercompanyElimination:async args=>(calls.push(['transition',args]),transitionReceipt(draft)),
  cancelIntercompanyElimination:async args=>(calls.push(['cancel',args]),cancelReceipt(draft)),
  postIntercompanyElimination:async args=>(calls.push(['post',args]),draft),
  ...overrides
 };
 const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:'11111111-1111-4111-8111-111111111111',actorId:'maker'}),kernelFactory:async()=>kernel});
 return {api,calls,draft,source,options};
}

const request=(url,body,key='intercompany-elimination-command-001')=>({method:'POST',url,headers:{'idempotency-key':key},body});
const createBody=draft=>({reportingPeriodId:draft.reporting_period_id,consolidationSnapshotId:draft.consolidation_snapshot_id,sourceEntityId:draft.source_entity_id,sourcePeriodId:draft.source_period_id,counterpartyEntityId:draft.counterparty_entity_id,counterpartyPeriodId:draft.counterparty_period_id,sourceAccountCode:draft.source_account_code,expectedSourceEvidenceHash:draft.source_evidence_hash,reason});

test('intercompany elimination HTTP binds reads and even empty options to the requested reporting and member scopes',async()=>{
 const {api,calls,draft}=setup(),base=`/api/v1/entities/${draft.reporting_entity_id}/intercompany-eliminations`;
 let response=await api({method:'GET',url:`${base}?reportingPeriodId=${draft.reporting_period_id}&limit=17`,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(calls[0][0],'register');
 const query=new URLSearchParams({reportingPeriodId:draft.reporting_period_id,groupRef:draft.group_ref,sourceEntityId:draft.source_entity_id,sourcePeriodId:draft.source_period_id,counterpartyEntityId:draft.counterparty_entity_id,counterpartyPeriodId:draft.counterparty_period_id});
 response=await api({method:'GET',url:`${base}/create-options?${query}`,headers:{},body:null});assert.equal(response.status,200);assert.equal(calls[1][0],'options');
 response=await api({method:'GET',url:`${base}/${draft.intercompany_elimination_batch_id}`,headers:{},body:null});assert.equal(response.status,200);assert.equal(calls[2][0],'batch');
 const wrong=setup({readIntercompanyEliminationCreateOptions:async()=>({...setup().options,counterparty_period_id:draft.source_period_id,options:[]})}).api;
 assert.equal((await wrong({method:'GET',url:`${base}/create-options?${query}`,headers:{},body:null})).status,502);
});

test('create returns 201 only for a new exact-scope receipt and 200 only for replay',async()=>{
 const {api,calls,draft}=setup(),url=`/api/v1/entities/${draft.reporting_entity_id}/intercompany-eliminations`,body=createBody(draft);
 let response=await api(request(url,body,'stable-create-key'));assert.equal(response.status,201);assert.equal(response.headers.etag,'"0"');assert.equal(calls[0][0],'create');assert.deepEqual(calls[0][1],{...body,tenantId:'11111111-1111-4111-8111-111111111111',reportingEntityId:draft.reporting_entity_id,idempotencyKey:'stable-create-key'});
 const replay=setup({createIntercompanyElimination:async()=>({...draft,idempotent:true})}).api;response=await replay(request(url,body,'stable-create-key'));assert.equal(response.status,200);
 for(const bad of [{...body,amount:'1.0000'},{...body,sourceEntityId:body.counterpartyEntityId},{...body,reason:'short'}])assert.equal((await api(request(url,bad))).status,400);
 for(const forged of [{...draft,status:'PENDING_REVIEW',revision:'1'},{...draft,reporting_period_id:draft.source_period_id},{...draft,idempotent:undefined}]){const forgedApi=setup({createIntercompanyElimination:async()=>forged}).api;assert.equal((await forgedApi(request(url,body))).status,502);}
});

test('lifecycle commands require exact revision, closed bodies and exact next-state receipts',async()=>{
 const {api,calls,draft}=setup(),base=`/api/v1/entities/${draft.reporting_entity_id}/intercompany-eliminations/${draft.intercompany_elimination_batch_id}`;
 let response=await api(request(`${base}/transitions`,{action:'submit',expectedRevision:0,reason},'stable-submit-key'));assert.equal(response.status,200);assert.equal(calls[0][0],'transition');assert.equal(calls[0][1].action,'SUBMIT');
 response=await api(request(`${base}/cancel`,{expectedRevision:0,reason},'stable-cancel-key'));assert.equal(response.status,200);assert.equal(calls[1][0],'cancel');
 assert.equal((await api(request(`${base}/post`,{expectedRevision:0,reason}))).status,400);assert.equal((await api(request(`${base}/post`,{}))).status,400);assert.equal((await api(request(`${base}/transitions`,{action:null,expectedRevision:0,reason}))).status,400);
 const forged=setup({transitionIntercompanyElimination:async()=>({...transitionReceipt(draft),revision:'2'})}).api;assert.equal((await forged(request(`${base}/transitions`,{action:'SUBMIT',expectedRevision:0,reason}))).status,502);
});
