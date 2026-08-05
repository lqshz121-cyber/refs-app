import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsInboundAutoRecReadComposition} from '../runtime/wbs-inbound-autorec-read-composition.mjs';

const scope={tenantId:'t1',entityId:'e1',companyKey:'COMPANY-A',sourceRecordIds:['bank-1','pay-1','control-1'],replayKey:'read-1'};
const receipt={receipt_id:'r1',receipt_ref:'object://wbs/r1',receipt_hash:'sha256:'+'a'.repeat(64)};
const bank={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'bank-1',source_version:'v1',source_type:'BANK_TRANSACTION',stage:'STAGING_REVIEWED',raw_event_id:'raw-b',source_document_id:'doc-b',staging_item_id:'stg-b',currency:'USD',amount:-100,business_date:'2026-08-01',accounting_date:'2026-08-01',bank_account_ref:'BANK-1'};
const payable={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'pay-1',source_version:'v1',source_type:'PAYABLE',stage:'STAGING_REVIEWED',raw_event_id:'raw-p',source_document_id:'doc-p',staging_item_id:'stg-p',currency:'USD',amount:100,business_date:'2026-08-01',accounting_date:'2026-08-01'};
const control={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'control-1',source_version:'v1',user_ref:'MASKED',completed_match_period:'M:08/2026',completed_release_period:'R:08/2026',completed_incur_period:'C:08/2026',quantity:1,released_quantity:0,incurred_quantity:0,amount:'100.0000',released_amount:'0.0000',incurred_amount:'0.0000',reconciliation_balance:'100.0000',new_balance:'100.0000',balance_date:'2026-08-01'};
const map=row=>({mapping_id:`map-${row.source_record_id}`,version:'1',status:'APPROVED',source_type:row.source_type,entity_id:'e1',company_key:'COMPANY-A',currency:'USD',...(row.source_type==='BANK_TRANSACTION'?{bank_account_ref:'BANK-1'}:{})});
function repository({badScope=false,fail=false}={}){return {readPersistedWbsInboundRows:async()=>{if(fail)throw Error('unavailable');return badScope?[{...bank,company_key:'COMPANY-B'}]:[bank,payable]},readPersistedWbsControlRows:async()=>({companyRows:[control],detailRows:[],persistedRows:[control]}),readApprovedWbsAutoRecMappings:async()=>[map(bank),map(payable)]};}

test('composes only scoped persisted receipt-backed rows and returns stable replay',async()=>{
  const reader=createWbsInboundAutoRecReadComposition({repository:repository()});const first=await reader.read(scope);assert.equal(first.status,'READ_ONLY_PROJECTED');assert.equal(first.candidates.length,2);assert.equal(first.can_post,false);
  const replay=await reader.read(scope);assert.equal(replay.replayed,true);assert.equal(replay.request_hash,first.request_hash);
  const changed=await reader.read({...scope,companyKey:'COMPANY-B'});assert.equal(changed.code,'WBS_AUTOREC_READ_REPLAY_CONFLICT');assert.equal(changed.candidates.length,0);
});

test('missing capability, read failure, and tenant/entity/company/source leakage fail closed with zero candidates',async()=>{
  assert.equal((await createWbsInboundAutoRecReadComposition({}).read(scope)).code,'WBS_AUTOREC_READ_CAPABILITY_UNAVAILABLE');
  assert.equal((await createWbsInboundAutoRecReadComposition({repository:repository({fail:true})}).read(scope)).code,'WBS_AUTOREC_READ_FAILED');
  const scoped=await createWbsInboundAutoRecReadComposition({repository:repository({badScope:true})}).read(scope);assert.equal(scoped.code,'WBS_AUTOREC_READ_SCOPE_INVALID');assert.equal(scoped.candidates.length,0);
});
