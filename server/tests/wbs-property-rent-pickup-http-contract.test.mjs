import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',admissionId='33333333-3333-4333-8333-333333333333',reviewId='44444444-4444-4444-8444-444444444444',periodId='55555555-5555-4555-8555-555555555555',evidenceHash=`sha256:${'a'.repeat(64)}`;
const principal={trusted:true,tenantId,actorId:'property-controller'};

test('Property Rent HTTP exposes GET-only readiness and guarded Review/Draft commands',async()=>{
 const calls=[],kernel={
  listWbsPropertyRentPickup:async args=>(calls.push(['list',args]),[]),
  reviewWbsPropertyRent:async args=>(calls.push(['review',args]),{review_evidence_id:reviewId,status:'READY_FOR_DRAFT',idempotent:false}),
  createWbsPropertyRentDraft:async args=>(calls.push(['draft',args]),{business_document_id:admissionId,journal_entry_id:reviewId,status:'DRAFT',idempotent:false})
 },api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>kernel});
 let response=await api({method:'GET',url:`/api/v1/entities/${entityId}/wbs/property-rent-pickup?periodId=${periodId}&limit=7`,headers:{},body:null});
 assert.equal(response.status,200);assert.deepEqual(calls.shift(),['list',{tenantId,entityId,periodId,limit:7}]);assert.equal(response.headers['cache-control'],'no-store');
 response=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/property-rent-pickup/${admissionId}/reviews`,headers:{'idempotency-key':'property-rent-review-001','if-match':'"0"'},body:{periodId,expectedEvidenceHash:evidenceHash,reason:'Independent Property Rent review'}});
 assert.equal(response.status,201);assert.deepEqual(calls.shift(),['review',{tenantId,entityId,admissionId,periodId,expectedRevision:0,expectedEvidenceHash:evidenceHash,reason:'Independent Property Rent review',idempotencyKey:'property-rent-review-001'}]);
 response=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/property-rent-pickup/reviews/${reviewId}/drafts`,headers:{'idempotency-key':'property-rent-draft-001','if-match':'"1"'},body:{expectedEvidenceHash:evidenceHash,reason:'Create exact reviewed rent Draft'}});
 assert.equal(response.status,201);assert.deepEqual(calls.shift(),['draft',{tenantId,entityId,reviewEvidenceId:reviewId,expectedRevision:1,expectedEvidenceHash:evidenceHash,reason:'Create exact reviewed rent Draft',idempotencyKey:'property-rent-draft-001'}]);
 for(const request of [
  {method:'GET',url:`/api/v1/entities/${entityId}/wbs/property-rent-pickup`,headers:{'idempotency-key':'forbidden-read'},body:null},
  {method:'GET',url:`/api/v1/entities/${entityId}/wbs/property-rent-pickup?limit=7`,headers:{},body:null},
  {method:'POST',url:`/api/v1/entities/${entityId}/wbs/property-rent-pickup/${admissionId}/reviews`,headers:{'idempotency-key':'property-rent-review-002'},body:{periodId,expectedEvidenceHash:evidenceHash,reason:'Missing precondition must fail'}},
  {method:'POST',url:`/api/v1/entities/${entityId}/wbs/property-rent-pickup/reviews/${reviewId}/drafts`,headers:{'idempotency-key':'property-rent-draft-002','if-match':'"0"'},body:{expectedEvidenceHash:'sha256:bad',reason:'Invalid evidence must fail'}},
  {method:'POST',url:`/api/v1/entities/${entityId}/wbs/property-rent-pickup/${admissionId}/reviews`,headers:{'idempotency-key':'property-rent-review-003','if-match':'"0"'},body:{periodId,expectedEvidenceHash:evidenceHash,reason:'Identity must remain server derived',entityId}}
 ])assert.ok((await api(request)).status>=400);
 assert.equal(calls.length,0);
});
