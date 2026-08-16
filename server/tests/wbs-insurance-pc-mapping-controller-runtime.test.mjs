import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {computeInsuranceFormalAdmissionReceiptHash,computeInsuranceFormalAdmissionRequestHash,validateInsuranceControlledLiveObservation,validateInsuranceFormalAdmissionBinding,validateInsurancePreAdmissionObservation,WbsInsurancePcMappingError} from '../runtime/wbs-insurance-pc-mapping-controller.mjs';

const h=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const actions={can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const writeDelta={admission:0,retention:0,coverage:0,staging:0,journal_entry:0,ledger:0,audit:0,outbox:0,model_call:0,storage_action:0};
const artifact=(name,index)=>({storage_ref:`s3://refs-evidence/tenant/entity/insurance/admission/${name}`,storage_version:`version-${index}`,content_hash:h(String.fromCharCode(97+index)),size_bytes:100+index,media_type:['receipt','package'].includes(name)?'application/json':'application/octet-stream',object_lock_mode:'COMPLIANCE',retain_until:'2033-08-16T00:00:00.000Z',scan_disposition:'CLEAN',scan_ref:`scan-${index}`,scan_hash:h(String.fromCharCode(101+index))});
const artifacts=Object.fromEntries(['receipt','request','response','package'].map((name,index)=>[name,artifact(name,index)]));
const observationBase={schema_version:'REFS_INSURANCE_PRE_ADMISSION_OBSERVATION_V1',observation_id:'7b79a865-4873-4d77-a758-b2bd3bd488dc',observation_hash:h('observation'),status:'PRE_ADMISSION_OBSERVATION',admission_state:'NOT_ADMITTED',source_kind:'PRE_ADMISSION_OBSERVATION',source_evidence_hash:h('evidence'),scope_kind:'FIRST_PACKAGE_WBPA',scope_pc_code_count:2,signature_algorithm:'Ed25519',signature_verified:true,artifact_set_hash:h('i'),package_hash:h('j'),source_payload_hash:h('k'),canonical_set_hash:h('l'),captured_at:'2026-08-16T00:00:00.000Z',record_count:12,null_pc_code_row_count:2,artifacts,actions,write_delta:writeDelta};
const observation={...observationBase,public_dto:{schema_version:'REFS_INSURANCE_PRE_ADMISSION_OBSERVATION_V1',observation_id:observationBase.observation_id,observation_hash:observationBase.observation_hash,status:observationBase.status,admission_state:observationBase.admission_state,source_kind:observationBase.source_kind,source_evidence_hash:observationBase.source_evidence_hash,scope_kind:observationBase.scope_kind,scope_pc_code_count:2,artifact_set_hash:observationBase.artifact_set_hash,package_hash:observationBase.package_hash,source_payload_hash:observationBase.source_payload_hash,canonical_set_hash:observationBase.canonical_set_hash,captured_at:observationBase.captured_at,record_count:12,null_pc_code_row_count:2}};
const approval={mapping_approval_id:'9c11327d-8d2d-4b66-9e72-66fda26751ce',canonical_mapping_decision_hash:h('m'),parent_company_mapping_hash:h('n'),status:'APPROVED',revoked:false};
const formalSeed={schema_version:'REFS_INSURANCE_FORMAL_ADMISSION_BINDING_V1',admission_id:'a2f04483-e205-4d93-904d-264abf268f12',controller_mapping_status:'APPROVED',mapping_approval_id:approval.mapping_approval_id,approval_revoked:false,observation_id:observation.observation_id,observation_hash:observation.observation_hash,proposal_hash:h('p'),decision_hash:approval.canonical_mapping_decision_hash,company_mapping_hash:approval.parent_company_mapping_hash,canonical_mapping_decision_hash:approval.canonical_mapping_decision_hash,parent_company_mapping_hash:approval.parent_company_mapping_hash,artifact_set_hash:observation.artifact_set_hash,package_hash:observation.package_hash,source_payload_hash:observation.source_payload_hash,artifacts,pre_admission_status:'PRE_ADMISSION_OBSERVATION',formal_admission_allowed:true,actions};
const formalWithRequest={...formalSeed,request_hash:computeInsuranceFormalAdmissionRequestHash(formalSeed)};
const formalBase={...formalWithRequest,receipt_hash:computeInsuranceFormalAdmissionReceiptHash(formalWithRequest)};
const formal={...formalBase,provenance:{admission_id:formalBase.admission_id,observation_id:formalBase.observation_id,observation_hash:formalBase.observation_hash,mapping_approval_id:formalBase.mapping_approval_id,canonical_mapping_decision_hash:formalBase.canonical_mapping_decision_hash,parent_company_mapping_hash:formalBase.parent_company_mapping_hash,receipt_hash:formalBase.receipt_hash,request_hash:formalBase.request_hash,artifact_set_hash:formalBase.artifact_set_hash,package_hash:formalBase.package_hash,source_payload_hash:formalBase.source_payload_hash,artifacts:formalBase.artifacts}};

test('Phase A requires exact Ed25519 ObjectLock versions hashes clean scans and zero actions',()=>{
  assert.doesNotThrow(()=>validateInsurancePreAdmissionObservation(observation));
  for(const invalid of [
    {...observation,signature_verified:false},
    {...observation,captured_at:'2026-08-16T00:00:00Z'},
    {...observation,artifacts:{...artifacts,package:{...artifacts.package,scan_disposition:'MALWARE_FOUND'}}},
    {...observation,actions:{...actions,can_create_draft:true}},
    {...observation,write_delta:{...writeDelta,audit:1}},
    {...observation,public_dto:{...observation.public_dto,request_raw:'secret'}}
  ])assert.throws(()=>validateInsurancePreAdmissionObservation(invalid),WbsInsurancePcMappingError);
});

test('Phase B binds exact current approval receipt request provenance and all four artifact coordinates',()=>{
  assert.doesNotThrow(()=>validateInsuranceFormalAdmissionBinding(formal,observation,approval));
  for(const [candidate,expected] of [
    [{...formal,mapping_approval_id:'11111111-1111-4111-8111-111111111111'},approval],
    [formal,{...approval,revoked:true}],
    [{...formal,request_hash:h('s')},approval],
    [{...formal,artifacts:{...artifacts,receipt:{...artifacts.receipt,storage_version:'drift'}}},approval],
    [{...formal,provenance:{...formal.provenance,canonical_mapping_decision_hash:h('t')}},approval]
  ])assert.throws(()=>validateInsuranceFormalAdmissionBinding(candidate,observation,expected),WbsInsurancePcMappingError);
});

test('controlled live pilot remains unsigned GET-only and cannot expose transport evidence',()=>{
  const base={schema_version:'REFS_INSURANCE_CONTROLLED_LIVE_OBSERVATION_V1',observation_id:'b9586c52-8b75-45aa-b970-71334ff1a3f8',status:'CONTROLLED_LIVE_PILOT',admission_state:'UNSIGNED_GET_ONLY',source_kind:'CONTROLLED_LIVE_PILOT',scope_kind:'FIRST_PACKAGE_WBPA',scope_pc_code_count:2,source_evidence_hash:h('u'),canonical_set_hash:h('v'),captured_at:'2026-08-16T00:00:00.000Z',record_count:12,null_pc_code_row_count:2,actions,write_delta:writeDelta};
  const live={...base,public_dto:{schema_version:base.schema_version,observation_id:base.observation_id,status:base.status,admission_state:base.admission_state,source_kind:base.source_kind,scope_kind:base.scope_kind,scope_pc_code_count:2,source_evidence_hash:base.source_evidence_hash,canonical_set_hash:base.canonical_set_hash,captured_at:base.captured_at,record_count:12,null_pc_code_row_count:2}};
  assert.doesNotThrow(()=>validateInsuranceControlledLiveObservation(live));
  assert.throws(()=>validateInsuranceControlledLiveObservation({...live,admission_state:'ADMITTED'}),WbsInsurancePcMappingError);
  assert.throws(()=>validateInsuranceControlledLiveObservation({...live,public_dto:{...live.public_dto,storage_version:'secret'}}),WbsInsurancePcMappingError);
});
