import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c';
const entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const proposalId='d66ad060-06b9-4af8-bd1c-756c6d69cf54';
const observationId='7b79a865-4873-4d77-a758-b2bd3bd488dc';
const sha=value=>`sha256:${value.repeat(64)}`;

function harness(){
  const calls=[];
  const kernel={
    async createWbsInsurancePcMappingProposal(input){calls.push(['propose',input]);return {proposal_id:proposalId,revision:0,status:'PENDING_CONTROLLER_APPROVAL',observation_hash:sha('a'),proposal_hash:sha('b'),canonical_set_hash:sha('c'),idempotent:false};},
    async approveWbsInsurancePcMappingProposal(input){calls.push(['approve',input]);return {proposal_id:proposalId,revision:1,status:'APPROVED',observation_hash:sha('a'),proposal_hash:sha('b'),decision_hash:sha('d'),company_mapping_hash:sha('e'),match_count:2,idempotent:false};},
    async getWbsInsurancePcMappingProposal(input){calls.push(['proposal',input]);return {proposal_id:proposalId,revision:1,status:'APPROVED',observation_hash:sha('a'),proposal_hash:sha('b'),decision_hash:sha('d'),company_mapping_hash:sha('e'),rows:[{proposal_row_id:'6d647f1d-ed9b-4bc7-8f9a-04e0450a83b4',pc_code:'PC-1',observed_row_count:2,row_hash:sha('f')}]};},
    async getWbsInsurancePcMappingTrace(input){calls.push(['trace',input]);return {pc_code:'PC-1',accounting_date:'2026-06-30',mapping_status:'CONTROLLER_APPROVED',company_code:'WBPA',match_count:1,observation_hash:sha('a'),proposal_hash:sha('b'),decision_hash:sha('d'),company_mapping_hash:sha('e')};}
  };
  return {calls,dispatch:createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller'}),kernelFactory:async()=>kernel})};
}

test('proposal accepts only an immutable server-derived observation reference',async()=>{
  const {dispatch,calls}=harness();
  const response=await dispatch({method:'POST',url:`/api/v1/entities/${entityId}/wbs/insurance/pc-mapping-proposals`,headers:{'idempotency-key':'insurance-pc-propose-001'},body:{observationId,expectedObservationHash:sha('a'),reason:'Controller proposes the exact server-derived observation for independent review.'}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.equal(calls.length,1);assert.equal(calls[0][1].tenantId,tenantId);assert.equal(calls[0][1].entityId,entityId);
  for(const forbidden of [{pcCodes:['PC-1']},{companyCode:'WBPA'},{aggregate:{pc_codes:['PC-1']}},{rawRows:[{pc_code:'PC-1'}]},{snapshotToken:'secret'},{capturedAt:'2026-08-16T00:00:00.000Z'}]){
    const denied=harness();const result=await denied.dispatch({method:'POST',url:`/api/v1/entities/${entityId}/wbs/insurance/pc-mapping-proposals`,headers:{'idempotency-key':'insurance-pc-propose-002'},body:{observationId,expectedObservationHash:sha('a'),reason:'Caller fields must never replace server-derived evidence.',...forbidden}});assert.equal(result.status,400);assert.equal(denied.calls.length,0);
  }
});

test('missing and ambiguous mapping traces are closed business evidence rather than server errors',async()=>{
  for(const [matchCount,mappingStatus] of [[0,'MISSING'],[2,'AMBIGUOUS']]){
    const calls=[];const kernel={async getWbsInsurancePcMappingTrace(input){calls.push(input);return {pc_code:'PC-X',accounting_date:'2026-06-30',match_count:matchCount,mapping_status:mappingStatus};}};
    const dispatch=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller'}),kernelFactory:async()=>kernel});
    const response=await dispatch({method:'GET',url:`/api/v1/entities/${entityId}/wbs/insurance/pc-company-mappings/trace?pcCode=PC-X&accountingDate=2026-06-30`,headers:{},body:null});
    assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data.mapping_status,mappingStatus);assert.equal(response.body.data.match_count,matchCount);assert.equal(Object.hasOwn(response.body.data,'decision_hash'),false);assert.equal(calls.length,1);
  }
});

test('proposal read rejects every non-closed nested row before HTTP serialization',async()=>{
  const kernel={async getWbsInsurancePcMappingProposal(){return {proposal_id:proposalId,revision:1,status:'APPROVED',observation_hash:sha('a'),proposal_hash:sha('b'),decision_hash:sha('d'),company_mapping_hash:sha('e'),rows:[{proposal_row_id:'6d647f1d-ed9b-4bc7-8f9a-04e0450a83b4',pc_code:'PC-1',observed_row_count:2,row_hash:sha('f'),provider_payload:'must-not-leak'}]};}};
  const dispatch=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller'}),kernelFactory:async()=>kernel});
  const response=await dispatch({method:'GET',url:`/api/v1/entities/${entityId}/wbs/insurance/pc-mapping-proposals/${proposalId}`,headers:{},body:null});
  assert.equal(response.status,500);assert.equal(JSON.stringify(response.body).includes('must-not-leak'),false);
});

test('approve uses strong revision exact hashes independent SoD and no-store',async()=>{
  const {dispatch,calls}=harness();
  const response=await dispatch({method:'POST',url:`/api/v1/entities/${entityId}/wbs/insurance/pc-mapping-proposals/${proposalId}/approve`,headers:{'idempotency-key':'insurance-pc-approve-001','if-match':'"0"'},body:{expectedObservationHash:sha('a'),expectedProposalHash:sha('b'),catalogDecisionId:'9c11327d-8d2d-4b66-9e72-66fda26751ce',expectedCompanyMappingHash:sha('e'),effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',reason:'Independent Controller approves the exact observed PC scope and catalog binding.'}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.equal(calls[0][0],'approve');assert.equal(calls[0][1].expectedRevision,0);
});

test('proposal and mapping trace reads are no-store and reject command headers or raw fields',async()=>{
  const {dispatch,calls}=harness();
  const proposal=await dispatch({method:'GET',url:`/api/v1/entities/${entityId}/wbs/insurance/pc-mapping-proposals/${proposalId}`,headers:{},body:null});
  const trace=await dispatch({method:'GET',url:`/api/v1/entities/${entityId}/wbs/insurance/pc-company-mappings/trace?pcCode=PC-1&accountingDate=2026-06-30`,headers:{},body:null});
  assert.equal(proposal.status,200);assert.equal(trace.status,200);assert.equal(proposal.headers['cache-control'],'no-store');assert.equal(trace.headers['cache-control'],'no-store');assert.equal(JSON.stringify([proposal,trace]).includes('raw_row'),false);assert.deepEqual(calls.map(item=>item[0]),['proposal','trace']);
  for(const request of [
    {method:'GET',url:`/api/v1/entities/${entityId}/wbs/insurance/pc-mapping-proposals/${proposalId}`,headers:{'idempotency-key':'forbidden-read'}},
    {method:'GET',url:`/api/v1/entities/${entityId}/wbs/insurance/pc-company-mappings/trace?pcCode=PC-1&accountingDate=2026-06-30&raw=true`,headers:{}}
  ])assert.equal((await dispatch({...request,body:null})).status,400);
});
