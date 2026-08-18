import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {createWbsProviderFinal1RetainedEvidenceAdmission} from '../runtime/wbs-provider-final1-retained-evidence-admission.mjs';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';

const hash=letter=>`sha256:${letter.repeat(64)}`;
const controlTotals={row_count:1,currency_totals:[{currency:'USD',row_count:1,amount_total:'10.0000'}]};
const controlTotalsHash=`sha256:${createHash('sha256').update(canonicalRequestBody(controlTotals),'utf8').digest('hex')}`;
const tenantId=randomUUID(),entityId=randomUUID(),actorId='provider-final1-service';

function service(domain){
  const stored=[],retained=[];
  const packageRaw=Buffer.from(JSON.stringify({domain,date_from:'2026-08-01',date_to:'2026-08-31'}));
  const verified={signature_verified:true,raw_contains_credentials:false,admission_blockers:[],snapshot_id:randomUUID(),source_tool:domain==='BANK'?'list_bank_transactions':'list_control_totals',date_from:'2026-08-01',date_to:'2026-08-31',row_count:1,control_totals:structuredClone(controlTotals),control_totals_hash:controlTotalsHash,package_hash:hash('d'),raw_package_hash:hash('e'),package:{captured_at:'2026-08-15T00:00:00.000Z'}};
  const plan={status:'NORMALIZED_FINAL1_BUSINESS_EVIDENCE_PLAN',plan_hash:hash('f'),provenance:{control_totals:structuredClone(controlTotals),control_totals_hash:controlTotalsHash},evidence_rows:[{}],can_create_transaction:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};
  const runtime=createWbsProviderFinal1RetainedEvidenceAdmission({
    principal:{trusted:true,actorId,tenantId,audiences:['wbs-final1']},serviceActorId:actorId,serviceAudience:'wbs-final1',serviceTenantId:tenantId,providerTrust:{public_key:'pinned'},clock:()=>Date.parse('2026-08-15T00:02:00Z'),
    kernel:{readWbsProviderFinal1AdmissionScope:async()=>({active:true,source_system:'WBS',company_code:'WBPA',base_currency:'USD',company_mapping_hash:hash('a')}),retainWbsProviderFinal1SourceEvidence:async args=>{retained.push(args);return {status:'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE',domain,admission_id:args.delivery.admission_id,signature_verified:true,can_write_wbs:false,can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};}},
    storage:{retentionDays:30,putOrphanLifecycleMarker:async()=>({}),inspectImmutableVersion:async()=>({}),readVerifiedVersion:async()=>Buffer.alloc(1),putImmutableVersion:async({artifact,expectedHash})=>{const value={storageRef:`s3://evidence/${artifact}`,storageVersion:`version-${artifact}`,sizeBytes:10,mediaType:artifact.endsWith('.json')?'application/json':'application/octet-stream',contentHash:expectedHash,retentionMode:'COMPLIANCE',retainUntil:'2026-09-15T00:02:00.000Z'};stored.push(value);return value;}},
    scanner:{scan:async({contentHash})=>({clean:true,scanRef:`clamav:${contentHash.slice(7)}:clean`})},
    verifyBusiness:()=>verified,normalizeBusiness:()=>plan,verifyPayables:()=>{},verifyInsurance:()=>{},normalizePayables:()=>{},normalizeInsurance:()=>{}
  });
  return {runtime,stored,retained,input:{domain,tenantId,entityId,receipt:{issuer:'provider',kid:'k1',nonce:'n1',signed_at:'2026-08-15T00:01:00Z',expires_at:'2026-08-15T00:16:00Z'},requestRawBase64:Buffer.from('request').toString('base64'),responseRawBase64:Buffer.from('response').toString('base64'),packageRawBase64:packageRaw.toString('base64'),idempotencyKey:`business-${domain.toLowerCase()}-0001`}};
}

test('Final-1 business admission reuses four immutable scanned objects and sends signed controls to one atomic kernel call',async()=>{
  assert.equal(controlTotalsHash,'sha256:faa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1');
  for(const domain of ['BANK','COST','PROPERTY']){const value=service(domain),result=await value.runtime.admit(value.input);assert.equal(result.domain,domain);assert.equal(value.stored.length,4);assert.equal(value.retained.length,1);assert.equal(value.retained[0].delivery.control_totals_hash,controlTotalsHash);assert.deepEqual(value.retained[0].delivery.control_totals,controlTotals);assert.equal('per_currency_totals' in value.retained[0].delivery,false);assert.equal(value.retained[0].plan.can_create_transaction,false);}
});

test('HTTP exposes only the three exact new Final-1 domain routes and never accepts a caller domain field',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId}),kernelFactory:async()=>({}),wbsProviderFinal1RetainedEvidenceServiceFactory:async()=>({admit:async args=>{seen.push(args);return {status:'ok'};}})});
  for(const [path,domain] of [['bank','BANK'],['cost','COST'],['property','PROPERTY']]){const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/provider-signed/final1/${path}/admissions`,headers:{'Idempotency-Key':`http-${path}-admission-0001`},body:{receipt:{},requestRawBase64:'YQ==',responseRawBase64:'Yg==',packageRawBase64:'Yw=='}});assert.equal(response.status,201);assert.equal(seen.at(-1).domain,domain);}
  const rejected=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/provider-signed/final1/bank/admissions`,headers:{'Idempotency-Key':'http-bank-admission-0002'},body:{receipt:{},requestRawBase64:'YQ==',responseRawBase64:'Yg==',packageRawBase64:'Yw==',domain:'PROPERTY'}});assert.equal(rejected.status,400);assert.equal(rejected.body.code,'UNEXPECTED_FIELD');
});

test('migration 167 is append-only, actor-bound, RLS scoped, five-domain controls and action-disabled business evidence',async()=>{
  const up=await readFile(new URL('../db/migrations/167_wbs_final1_signed_business_evidence.sql',import.meta.url),'utf8'),down=await readFile(new URL('../db/migrations/down/167_wbs_final1_signed_business_evidence.sql',import.meta.url),'utf8'),manifest=await readFile(new URL('../runtime/migration-manifest.mjs',import.meta.url),'utf8');
  for(const token of ['wbs_final1_signed_control_total','wbs_final1_signed_business_source_row',"'PAYABLES','INSURANCE','BANK','COST','PROPERTY'",'ENABLE ROW LEVEL SECURITY','reject_mutation','refs_record_wbs_final1_signed_control_total','refs_retain_wbs_final1_business_evidence','refs_retain_wbs_final1_source_evidence_with_signed_controls','refs_assert_wbs_final1_signed_artifacts','v_idem.actor_id IS DISTINCT FROM v_actor','WBS_FINAL1_SIGNED_CONTROL_TOTAL_RETAINED','can_create_transaction',"'CONTROL_EVIDENCE_ONLY'",'refs_canonical_jsonb_text','refs_canonical_jsonb_hash','refs_wbs_final1_control_totals_valid','currency_totals','amount_total','v_recomputed_control_totals','Signed control totals differ from the exact persisted source population',"retentionMode']<>'COMPLIANCE'",'media_type',"d.active_status='ACTIVE'",'REVOKE ALL ON FUNCTION refs_canonical_jsonb_text(jsonb)'])assert.ok(up.includes(token),`migration missing ${token}`);
  assert.equal(up.includes('per_currency_totals'),false,'migration retains rejected canonical-total token per_currency_totals');
  assert.doesNotMatch(up,/refs_jsonb_hash\(jsonb_build_object\('row_count'/);
  assert.doesNotMatch(up,/jsonb_build_object\('currency',\s*currency,\s*'gross_amount'/);
  assert.match(up,/faa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1/);
  for(const mapping of ["WHEN 'BANK' THEN 'bankFeed'","WHEN 'COST' THEN 'cost_general_ledger'","WHEN 'PROPERTY' THEN 'pmCharge'"])assert.ok(up.includes(mapping),`migration missing canonical source module mapping ${mapping}`);
  assert.match(up,/raw_event[^;]+v_source_module/is);assert.match(up,/source_document[^;]+v_source_module/is);
  assert.match(up,/import_batch[^;]+v_tool/is);assert.match(up,/wbs_final1_signed_business_source_row[^;]+v_tool/is);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_retain_wbs_final1_source_evidence\(uuid,uuid,jsonb,jsonb,jsonb,text,text\) FROM refs_app/);
  assert.match(down,/GRANT EXECUTE ON FUNCTION refs_retain_wbs_final1_source_evidence\(uuid,uuid,jsonb,jsonb,jsonb,text,text\) TO refs_app/);
  assert.match(down,/Cannot remove migration 167 while signed control\/business evidence exists/);assert.match(manifest,/167_wbs_final1_signed_business_evidence\.sql/);
});

test('OpenAPI publishes closed Bank/Cost/Property Final-1 evidence commands without claiming transaction authority',async()=>{
  const api=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  for(const [domain,operationId] of [['bank','retainProviderSignedWbsFinal1Bank'],['cost','retainProviderSignedWbsFinal1CostControl'],['property','retainProviderSignedWbsFinal1PropertyControl']]){const operation=api.paths[`/entities/{entityId}/wbs/provider-signed/final1/${domain}/admissions`]?.post;assert.equal(operation.operationId,operationId);assert.equal(operation.requestBody.$ref,'#/components/requestBodies/WbsProviderFinal1Admission');assert.match(operation.description,/no |never |does not |cannot /i);}
});
