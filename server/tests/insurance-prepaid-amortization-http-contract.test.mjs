import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAccountingApi} from '../api/accounting-http.mjs';

const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-${String(n).padStart(12,'0')}`,hash=n=>`sha256:${String(n).repeat(64).slice(0,64)}`;
const tenantId=uuid(1),entityId=uuid(2),periodId=uuid(3),reviewId=uuid(4),principal={trusted:true,tenantId,actorId:'insurance-controller'};
const reviewBody={admissionId:uuid(5),scheduleId:uuid(6),scheduleLineId:uuid(7),periodId,settingSnapshotId:uuid(8),mappingSnapshotId:uuid(9),capitalizationJournalEntryId:uuid(10),capitalizationLedgerLineId:uuid(11),expectedSourceHash:hash(1),expectedProposalHash:hash(2),expectedCoverageHash:hash(3),reason:'Independent Insurance review.'};

test('Insurance amortization HTTP is no-store GET plus strong-CAS Review and immutable-review Draft',async()=>{
  const calls=[],kernel={listInsurancePrepaidAmortization:async args=>(calls.push(['list',args]),[]),reviewInsurancePrepaidAmortization:async args=>(calls.push(['review',args]),{status:'INDEPENDENTLY_REVIEWED',idempotent:false}),createInsurancePrepaidAmortizationDraft:async args=>(calls.push(['draft',args]),{status:'DRAFT',idempotent:false})},api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>kernel});
  let result=await api({method:'GET',url:`/api/v1/entities/${entityId}/prepaid/amortization?periodId=${periodId}&limit=7`,headers:{},body:null});assert.equal(result.status,200);assert.equal(result.headers['cache-control'],'no-store');assert.deepEqual(calls.shift(),['list',{tenantId,entityId,periodId,limit:7}]);
  result=await api({method:'POST',url:`/api/v1/entities/${entityId}/prepaid/amortization/reviews`,headers:{'idempotency-key':'insurance-review-001','if-match':'"7"'},body:reviewBody});assert.equal(result.status,201);assert.deepEqual(calls.shift(),['review',{tenantId,entityId,...reviewBody,expectedSourceVersion:7,idempotencyKey:'insurance-review-001'}]);
  result=await api({method:'POST',url:`/api/v1/entities/${entityId}/prepaid/amortization/reviews/${reviewId}/drafts`,headers:{'idempotency-key':'insurance-draft-001','if-match':'"0"'},body:{expectedEvidenceHash:hash(4),reason:'Prepare reviewed monthly Draft.'}});assert.equal(result.status,201);assert.deepEqual(calls.shift(),['draft',{tenantId,entityId,reviewEvidenceId:reviewId,expectedEvidenceHash:hash(4),reason:'Prepare reviewed monthly Draft.',idempotencyKey:'insurance-draft-001'}]);
  for(const request of [
    {method:'GET',url:`/api/v1/entities/${entityId}/prepaid/amortization?periodId=${periodId}`,headers:{'if-match':'"0"'},body:null},
    {method:'GET',url:`/api/v1/entities/${entityId}/prepaid/amortization?periodId=${periodId}&limit=101`,headers:{},body:null},
    {method:'POST',url:`/api/v1/entities/${entityId}/prepaid/amortization/reviews`,headers:{'idempotency-key':'insurance-review-002'},body:reviewBody},
    {method:'POST',url:`/api/v1/entities/${entityId}/prepaid/amortization/reviews`,headers:{'idempotency-key':'insurance-review-003','if-match':'W/"7"'},body:reviewBody},
    {method:'POST',url:`/api/v1/entities/${entityId}/prepaid/amortization/reviews`,headers:{'idempotency-key':'insurance-review-004','if-match':'"7"'},body:{...reviewBody,entityId}},
    {method:'POST',url:`/api/v1/entities/${entityId}/prepaid/amortization/reviews/${reviewId}/drafts`,headers:{'idempotency-key':'insurance-draft-002','if-match':'"1"'},body:{expectedEvidenceHash:hash(4),reason:'Stale immutable review revision.'}}
  ])assert.ok((await api(request)).status>=400);
  assert.equal(calls.length,0);
});

const here=resolve(fileURLToPath(new URL('.',import.meta.url))),repository=await readFile(resolve(here,'../runtime/kernel-repository.mjs'),'utf8'),cas=await readFile(resolve(here,'../db/migrations/160_insurance_prepaid_amortization_http_cas.sql'),'utf8'),down=await readFile(resolve(here,'../db/migrations/down/160_insurance_prepaid_amortization_http_cas.sql'),'utf8'),openapi=JSON.parse(await readFile(resolve(here,'../api/openapi-accounting.json'),'utf8'));

test('repository and database wrapper bind the strong source version before migration 141 review',()=>{
  assert.match(repository,/async listInsurancePrepaidAmortization/);assert.match(repository,/refs_read_insurance_prepaid_amortization\(\$1,\$2,\$3,\$4\)/);assert.match(repository,/refs_review_insurance_prepaid_amortization_http/);assert.match(repository,/refs_create_insurance_prepaid_amortization_draft_hash/);
  assert.match(cas,/current_source_version<>p_expected_source_version/);assert.match(cas,/schedule_version<>p_expected_source_version/);assert.match(cas,/FOR SHARE OF s,d/);assert.match(cas,/refs_review_insurance_prepaid_amortization\(/);assert.doesNotMatch(cas,/INSERT INTO|UPDATE |DELETE FROM/i);assert.match(down,/DROP FUNCTION refs_review_insurance_prepaid_amortization_http/);
});

test('OpenAPI separates GET evidence, independent Review, Draft-only creation, and standard Post',()=>{
  const paths=openapi.paths,get=paths['/entities/{entityId}/prepaid/amortization']?.get,review=paths['/entities/{entityId}/prepaid/amortization/reviews']?.post,draft=paths['/entities/{entityId}/prepaid/amortization/reviews/{reviewEvidenceId}/drafts']?.post;
  assert.equal(get.operationId,'listInsurancePrepaidAmortization');assert.match(get.description,/MONEY4/);assert.match(get.description,/AI proposals remain PROPOSED/);
  assert.equal(review.operationId,'reviewInsurancePrepaidAmortization');assert.ok(review.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IfMatch'));assert.match(review.description,/creates no Draft/);
  assert.equal(draft.operationId,'createInsurancePrepaidAmortizationDraft');assert.ok(draft.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IfMatch'));assert.match(draft.description,/Standard Submit, Review, Approve and Post remain separate/);assert.match(draft.description,/no automatic posting/);
});
