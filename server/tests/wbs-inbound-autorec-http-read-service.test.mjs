import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsInboundAutoRecHttpReadService} from '../runtime/wbs-inbound-autorec-http-read-service.mjs';

const receipt={receipt_id:'r1',receipt_ref:'object://wbs/r1',receipt_hash:'sha256:'+'a'.repeat(64)};
const bank={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'bank-1',source_version:'v1',source_type:'BANK_TRANSACTION',stage:'STAGING_REVIEWED',raw_event_id:'raw-b',source_document_id:'doc-b',staging_item_id:'stg-b',currency:'USD',amount:-100,business_date:'2026-08-01',accounting_date:'2026-08-01',bank_account_ref:'BANK-1'};
const control={...receipt,tenant_id:'t1',entity_id:'e1',company_key:'COMPANY-A',source_record_id:'control-1',source_version:'v1',user_ref:'MASKED',completed_match_period:'M:08/2026',completed_release_period:'R:08/2026',completed_incur_period:'C:08/2026',quantity:1,released_quantity:0,incurred_quantity:0,amount:'100.0000',released_amount:'0.0000',incurred_amount:'0.0000',reconciliation_balance:'100.0000',new_balance:'100.0000',balance_date:'2026-08-01'};
const mapping={mapping_id:'map-bank',version:'1',snapshot_hash:'sha256:'+'b'.repeat(64),status:'APPROVED',source_type:'BANK_TRANSACTION',entity_id:'e1',company_key:'COMPANY-A',currency:'USD',bank_account_ref:'BANK-1',effective_from:'2026-01-01T00:00:00.000Z',effective_to:null};

test('HTTP WBS read service injects only the receipt-backed kernel reader and creates no command path',async()=>{
  const calls=[];
  const kernel={
    readPersistedWbsInboundRows:async input=>(calls.push(['inbound',input]),[bank]),
    readPersistedWbsControlRows:async input=>(calls.push(['control',input]),{companyRows:[control],detailRows:[],persistedRows:[control]}),
    readApprovedWbsAutoRecMappings:async input=>(calls.push(['mapping',input]),[mapping]),
    readWbsAutoRecObservedStateEvidence:async input=>(calls.push(['state',input]),[])
  };
  const service=createWbsInboundAutoRecHttpReadService({kernel});
  const input={tenantId:'t1',entityId:'e1',companyKey:'COMPANY-A',sourceRecordIds:['control-1','bank-1']};
  const first=await service.readAutoRecReview(input),replay=await service.readAutoRecReview(input);
  assert.equal(first.status,'READ_ONLY_PROJECTED');assert.equal(first.can_dispatch,false);assert.equal(first.can_create_draft,false);assert.equal(first.can_post,false);assert.equal(replay.replayed,true);
  assert.equal(calls.length,4);assert.ok(calls.every(([,request])=>request.read_only===true));
  assert.equal(typeof service.createAutoJournal,'undefined');assert.equal(typeof service.postJournal,'undefined');
});
