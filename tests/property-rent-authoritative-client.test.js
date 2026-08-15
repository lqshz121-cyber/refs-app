import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthoritativeWbsPropertyRentDraft,refreshAuthoritativeWbsPropertyRentPickup,reviewAuthoritativeWbsPropertyRent} from '../src/accounting-api.js';

const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-${String(n).padStart(12,'0')}`;
const hash=char=>`sha256:${char.repeat(64)}`;
const config={baseUrl:'https://accounting.example',entityId:id(1),periodId:id(2),getAccessToken:async()=>'.'.repeat(16)};
const row={wbs_property_rent_source_admission_id:id(3),wbs_property_rent_review_evidence_id:null,wbs_property_rent_draft_evidence_id:null,source_document_id:id(4),staging_item_id:id(5),business_document_id:null,journal_entry_id:null,period_id:null,mapping_snapshot_id:null,mapping_snapshot_hash:null,mapping_version:null,source_version:'rent-v1',receipt_hash:hash('a'),evidence_hash:hash('b'),property_ref:'PROP-01',unit_ref:'UNIT-01',lease_ref:'LEASE-01',tenant_ref:'TENANT-01',document_number:'RENT-0001',accounting_date:'2026-08-01',due_date:null,currency:'USD',gross_amount:'1250.0000',workflow_status:'PENDING_REVIEW',revision:0,admitted_by:'rent-admitter',reviewed_by:null,drafted_by:null,reviewed_at:null,drafted_at:null,posted_at:null,can_review:true,can_create_draft:false,can_post:false};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>({ok:true,data})});

test('Property Rent client rejects malformed MONEY4 and accepts exact queue evidence',async()=>{
  let result=await refreshAuthoritativeWbsPropertyRentPickup({config,fetcher:async()=>response([row])});
  assert.equal(result.ok,true);assert.equal(result.rows[0].gross_amount,'1250.0000');
  result=await refreshAuthoritativeWbsPropertyRentPickup({config,fetcher:async()=>response([{...row,gross_amount:'1250.1'}])});
  assert.deepEqual(result.ok,false);assert.equal(result.code,'PROPERTY_RENT_PICKUP_PROTOCOL');
  result=await refreshAuthoritativeWbsPropertyRentPickup({config,fetcher:async()=>response([{...row,workflow_status:'SUBMITTED'}])});
  assert.equal(result.ok,false);
});

test('Property Rent commands bind exact evidence hash and real If-Match revision',async()=>{
  const calls=[],fetcher=async(url,options)=>{calls.push({url,options});return response({review_evidence_id:id(6),source_document_id:row.source_document_id,staging_item_id:row.staging_item_id,mapping_snapshot_id:id(7),status:'READY_FOR_DRAFT',period_id:config.periodId,revision:1,idempotent:false,can_create_draft:false,can_post:false},201);};
  const reviewed=await reviewAuthoritativeWbsPropertyRent({config,evidence:row,periodId:config.periodId,reason:'Independent review of exact rent evidence',idempotencyKey:'rent-review-0001',fetcher});
  assert.equal(reviewed.ok,true);assert.equal(calls[0].options.headers['if-match'],'"0"');assert.deepEqual(JSON.parse(calls[0].options.body),{periodId:config.periodId,expectedEvidenceHash:row.evidence_hash,reason:'Independent review of exact rent evidence'});
  const ready={...row,wbs_property_rent_review_evidence_id:id(6),period_id:config.periodId,mapping_snapshot_id:id(7),mapping_snapshot_hash:hash('c'),mapping_version:3,workflow_status:'READY_FOR_DRAFT',revision:1,reviewed_by:'rent-reviewer',reviewed_at:'2026-08-16T00:00:00.000Z',can_review:false,can_create_draft:true};
  const draftFetcher=async(url,options)=>{calls.push({url,options});return response({draft_evidence_id:id(8),review_evidence_id:id(6),source_document_id:row.source_document_id,staging_item_id:row.staging_item_id,business_document_id:id(9),journal_entry_id:id(10),mapping_snapshot_id:id(7),status:'DRAFT',revision:0,staging_version:2,idempotent:false,can_submit:false,can_review:false,can_approve:false,can_post:false},201);};
  const drafted=await createAuthoritativeWbsPropertyRentDraft({config,evidence:ready,reason:'Create exact reviewed rent Draft only',idempotencyKey:'rent-draft-0001',fetcher:draftFetcher});
  assert.equal(drafted.ok,true);assert.equal(calls[1].options.headers['if-match'],'"1"');assert.deepEqual(JSON.parse(calls[1].options.body),{expectedEvidenceHash:ready.evidence_hash,reason:'Create exact reviewed rent Draft only'});
});

test('Property Rent client performs zero HTTP calls for stale action capabilities',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw new Error('must not call');};
  assert.equal((await reviewAuthoritativeWbsPropertyRent({config,evidence:{...row,can_review:false},periodId:config.periodId,reason:'Independent review denied by capability',idempotencyKey:'rent-review-0002',fetcher})).ok,false);
  assert.equal((await createAuthoritativeWbsPropertyRentDraft({config,evidence:row,reason:'Draft denied by capability state',idempotencyKey:'rent-draft-0002',fetcher})).ok,false);
  assert.equal(calls,0);
});
