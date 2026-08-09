import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresWbsInboundAutoRecReader} from '../runtime/wbs-inbound-autorec-postgres-reader.mjs';

const scope={tenantId:'t1',entityId:'e1',companyKey:'COMPANY-A',sourceRecordIds:['bank-1','control-1'],replayKey:'reader-1'};
const receipt={receipt_id:'r1',receipt_ref:'object://wbs/r1',receipt_hash:'sha256:'+'a'.repeat(64)};
const bank={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'bank-1',source_version:'v1',source_type:'BANK_TRANSACTION',stage:'STAGING_REVIEWED',raw_event_id:'raw-b',source_document_id:'doc-b',staging_item_id:'stg-b',currency:'USD',amount:-100,business_date:'2026-08-01',accounting_date:'2026-08-01',bank_account_ref:'BANK-1'};
const control={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'control-1',source_version:'v1',user_ref:'MASKED',completed_match_period:'M:08/2026',completed_release_period:'R:08/2026',completed_incur_period:'C:08/2026',quantity:1,released_quantity:0,incurred_quantity:0,amount:'100.0000',released_amount:'0.0000',incurred_amount:'0.0000',reconciliation_balance:'100.0000',new_balance:'100.0000',balance_date:'2026-08-01'};
const mapping={mapping_id:'map-bank',version:'1',snapshot_hash:'sha256:'+'b'.repeat(64),status:'APPROVED',source_type:'BANK_TRANSACTION',entity_id:'e1',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',effective_from:'2026-01-01T00:00:00.000Z',effective_to:null};

test('factory injects only scoped read capabilities and returns a non-dispatchable projection',async()=>{
  const calls=[];
  const state={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'bank-1',source_version:'v1',observed_at:'2026-08-01T00:00:00Z',observed_state:'NOT_MATCHED',observed_workflow_step:'DATA_PROCESSING_RELEASE'};
  const kernel={readPersistedWbsInboundRows:async input=>(calls.push(['inbound',input]),[bank]),readPersistedWbsControlRows:async input=>(calls.push(['control',input]),{companyRows:[control],detailRows:[],persistedRows:[control]}),readApprovedWbsAutoRecMappings:async input=>(calls.push(['mapping',input]),[mapping]),readApprovedWbsAutoRecMatchingPolicies:async input=>(calls.push(['policy',input]),[]),readWbsAutoRecObservedStateEvidence:async input=>(calls.push(['state',input]),[state])};
  const result=await createPostgresWbsInboundAutoRecReader({kernel}).read(scope);
  assert.equal(result.status,'READ_ONLY_PROJECTED');assert.equal(result.candidates.length,1);assert.equal(result.observed_state_evidence[0].can_incur,false);assert.equal(result.can_dispatch,false);assert.equal(result.can_create_draft,false);assert.equal(result.can_post,false);
  assert.deepEqual(calls.map(([name])=>name).sort(),['control','inbound','mapping','policy','state']);assert.ok(calls.every(([,input])=>input.read_only===true&&input.tenantId==='t1'&&input.entityId==='e1'&&input.companyKey==='COMPANY-A'));
});

test('missing capability, repository failure, and cross-scope rows return zero candidates',async()=>{
  assert.equal((await createPostgresWbsInboundAutoRecReader({kernel:{}}).read(scope)).code,'WBS_AUTOREC_READ_CAPABILITY_UNAVAILABLE');
  const failure={readPersistedWbsInboundRows:async()=>{throw Error('masked');},readPersistedWbsControlRows:async()=>({companyRows:[],detailRows:[],persistedRows:[]}),readApprovedWbsAutoRecMappings:async()=>[],readApprovedWbsAutoRecMatchingPolicies:async()=>[],readWbsAutoRecObservedStateEvidence:async()=>[]};
  assert.equal((await createPostgresWbsInboundAutoRecReader({kernel:failure}).read(scope)).code,'WBS_AUTOREC_READ_FAILED');
  const leaked={readPersistedWbsInboundRows:async()=>[{...bank,entity_id:'e2'}],readPersistedWbsControlRows:async()=>({companyRows:[control],detailRows:[],persistedRows:[control]}),readApprovedWbsAutoRecMappings:async()=>[mapping],readApprovedWbsAutoRecMatchingPolicies:async()=>[],readWbsAutoRecObservedStateEvidence:async()=>[]};
  const blocked=await createPostgresWbsInboundAutoRecReader({kernel:leaked}).read(scope);assert.equal(blocked.code,'WBS_AUTOREC_READ_SCOPE_INVALID');assert.equal(blocked.candidates.length,0);
});
