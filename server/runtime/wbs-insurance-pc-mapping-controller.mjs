import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ARTIFACTS=Object.freeze(['receipt','request','response','package']);
const ACTIONS=Object.freeze(['can_propose_amortization','can_create_draft','can_review','can_approve','can_post']);

export class WbsInsurancePcMappingError extends Error{
  constructor(code,message){super(message);this.code=code;}
}
const fail=(code,message)=>{throw new WbsInsurancePcMappingError(code,message);};
const object=(value,name)=>{if(!value||typeof value!=='object'||Array.isArray(value))fail('WBS_INSURANCE_PC_MAPPING_SCHEMA_INVALID',`${name} must be an object`);return value;};
const closed=(value,keys,name)=>{object(value,name);const expected=new Set(keys);if(Object.keys(value).some(key=>!expected.has(key))||keys.some(key=>!Object.hasOwn(value,key)))fail('WBS_INSURANCE_PC_MAPPING_SCHEMA_INVALID',`${name} must use the closed schema`);return value;};
const hash=(value,name)=>{if(typeof value!=='string'||!HASH.test(value))fail('WBS_INSURANCE_PC_MAPPING_HASH_INVALID',`${name} must be a canonical sha256 hash`);return value;};
const uuid=(value,name)=>{if(typeof value!=='string'||!UUID.test(value))fail('WBS_INSURANCE_PC_MAPPING_ID_INVALID',`${name} must be a UUID`);return value;};
const canonicalUtc=(value,name)=>{if(typeof value!=='string'||!UTC.test(value)||new Date(value).toISOString()!==value)fail('WBS_INSURANCE_PC_MAPPING_TIME_INVALID',`${name} must be canonical UTC milliseconds`);return value;};
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const canonicalHash=value=>`sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
const containsForbiddenKey=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>/(?:raw|token|secret|credential|storage)/i.test(key)||containsForbiddenKey(item));

export const computeInsuranceFormalAdmissionRequestHash=value=>canonicalHash({schema_version:'REFS_INSURANCE_FORMAL_ADMISSION_REQUEST_V1',admission_id:value.admission_id,observation_id:value.observation_id,observation_hash:value.observation_hash,proposal_hash:value.proposal_hash,mapping_approval_id:value.mapping_approval_id,canonical_mapping_decision_hash:value.canonical_mapping_decision_hash,parent_company_mapping_hash:value.parent_company_mapping_hash,artifact_set_hash:value.artifact_set_hash,package_hash:value.package_hash,source_payload_hash:value.source_payload_hash,artifacts:value.artifacts});
export const computeInsuranceFormalAdmissionReceiptHash=value=>canonicalHash({schema_version:'REFS_INSURANCE_FORMAL_ADMISSION_RECEIPT_V1',admission_id:value.admission_id,request_hash:value.request_hash,observation_id:value.observation_id,observation_hash:value.observation_hash,mapping_approval_id:value.mapping_approval_id,canonical_mapping_decision_hash:value.canonical_mapping_decision_hash,parent_company_mapping_hash:value.parent_company_mapping_hash,artifact_set_hash:value.artifact_set_hash,artifacts:value.artifacts});

function assertZeroActions(actions){closed(actions,ACTIONS,'actions');for(const key of ACTIONS)if(actions[key]!==false)fail('WBS_INSURANCE_PC_MAPPING_ACTION_FORBIDDEN','Pre-admission and mapping evidence cannot enable accounting actions');}
function assertZeroWrites(delta,name){closed(delta,['admission','retention','coverage','staging','journal_entry','ledger','audit','outbox','model_call','storage_action'],name);for(const value of Object.values(delta))if(value!==0)fail('WBS_INSURANCE_PC_MAPPING_WRITE_FORBIDDEN','Pre-admission observation must have zero business, evidence, model, and storage action writes');}
function validateArtifact(value,name){
  closed(value,['storage_ref','storage_version','content_hash','size_bytes','media_type','object_lock_mode','retain_until','scan_disposition','scan_ref','scan_hash'],`artifacts.${name}`);
  if(typeof value.storage_ref!=='string'||!/^s3:\/\/[a-z0-9][a-z0-9.-]{1,62}\/[A-Za-z0-9!_.*'()\-/]{1,1024}$/.test(value.storage_ref))fail('WBS_INSURANCE_PC_MAPPING_ARTIFACT_INVALID','Artifact storage reference must be a canonical secret-free s3 URI');
  if(typeof value.storage_version!=='string'||value.storage_version.length<1||value.storage_version.length>512||value.storage_version.startsWith('pending:'))fail('WBS_INSURANCE_PC_MAPPING_ARTIFACT_INVALID','Artifact VersionId must be final and exact');
  hash(value.content_hash,`${name}.content_hash`);hash(value.scan_hash,`${name}.scan_hash`);
  if(!Number.isSafeInteger(value.size_bytes)||value.size_bytes<1)fail('WBS_INSURANCE_PC_MAPPING_ARTIFACT_INVALID','Artifact size must be a positive safe integer');
  if(!['application/json','application/octet-stream'].includes(value.media_type)||value.object_lock_mode!=='COMPLIANCE'||value.scan_disposition!=='CLEAN')fail('WBS_INSURANCE_PC_MAPPING_ARTIFACT_INVALID','Artifact type, Object Lock mode, and clean scan must be exact');
  canonicalUtc(value.retain_until,`${name}.retain_until`);
  if(typeof value.scan_ref!=='string'||value.scan_ref.length<1||value.scan_ref.length>512||/[\u0000-\u001f\u007f]/.test(value.scan_ref))fail('WBS_INSURANCE_PC_MAPPING_ARTIFACT_INVALID','Artifact scan reference must be canonical');
  return value;
}

export function validateInsurancePreAdmissionObservation(value){
  closed(value,['schema_version','observation_id','observation_hash','status','admission_state','source_kind','source_evidence_hash','scope_kind','scope_pc_code_count','signature_algorithm','signature_verified','artifact_set_hash','package_hash','source_payload_hash','canonical_set_hash','captured_at','record_count','null_pc_code_row_count','artifacts','actions','write_delta','public_dto'], 'preAdmissionObservation');
  if(value.schema_version!=='REFS_INSURANCE_PRE_ADMISSION_OBSERVATION_V1'||value.status!=='PRE_ADMISSION_OBSERVATION'||value.admission_state!=='NOT_ADMITTED'||value.source_kind!=='PRE_ADMISSION_OBSERVATION'||value.scope_kind!=='FIRST_PACKAGE_WBPA')fail('WBS_INSURANCE_PC_MAPPING_PRE_ADMISSION_INVALID','Observation must remain first-package pre-admission evidence');
  uuid(value.observation_id,'observation_id');
  if(value.signature_algorithm!=='Ed25519'||value.signature_verified!==true)fail('WBS_INSURANCE_PC_MAPPING_SIGNATURE_INVALID','Ed25519 verification is required');
  for(const name of ['observation_hash','source_evidence_hash','artifact_set_hash','package_hash','source_payload_hash','canonical_set_hash'])hash(value[name],name);
  canonicalUtc(value.captured_at,'captured_at');
  if(!Number.isSafeInteger(value.record_count)||value.record_count<1||!Number.isSafeInteger(value.null_pc_code_row_count)||value.null_pc_code_row_count<0||value.null_pc_code_row_count>value.record_count||!Number.isSafeInteger(value.scope_pc_code_count)||value.scope_pc_code_count<1||value.scope_pc_code_count>value.record_count)fail('WBS_INSURANCE_PC_MAPPING_COUNT_INVALID','Observation counts are invalid');
  closed(value.artifacts,ARTIFACTS,'artifacts');for(const name of ARTIFACTS)validateArtifact(value.artifacts[name],name);
  assertZeroActions(value.actions);assertZeroWrites(value.write_delta,'write_delta');
  closed(value.public_dto,['schema_version','observation_id','observation_hash','status','admission_state','source_kind','source_evidence_hash','scope_kind','scope_pc_code_count','artifact_set_hash','package_hash','source_payload_hash','canonical_set_hash','captured_at','record_count','null_pc_code_row_count'],'public_dto');
  if(JSON.stringify(value.public_dto).match(/raw|token|secret|credential|storage_ref/i))fail('WBS_INSURANCE_PC_MAPPING_PUBLIC_DTO_UNSAFE','Public observation DTO contains forbidden transport data');
  for(const key of ['schema_version','observation_id','observation_hash','status','admission_state','source_kind','source_evidence_hash','scope_kind','scope_pc_code_count','artifact_set_hash','package_hash','source_payload_hash','canonical_set_hash','captured_at','record_count','null_pc_code_row_count'])if(value.public_dto[key]!==value[key])fail('WBS_INSURANCE_PC_MAPPING_PUBLIC_DTO_INVALID','Public observation DTO is not bound to the exact observation');
  return freeze(structuredClone(value));
}

export function validateInsuranceControlledLiveObservation(value){
  closed(value,['schema_version','observation_id','status','admission_state','source_kind','scope_kind','scope_pc_code_count','source_evidence_hash','canonical_set_hash','captured_at','record_count','null_pc_code_row_count','actions','write_delta','public_dto'],'controlledLiveObservation');
  if(value.schema_version!=='REFS_INSURANCE_CONTROLLED_LIVE_OBSERVATION_V1'||value.status!=='CONTROLLED_LIVE_PILOT'||value.admission_state!=='UNSIGNED_GET_ONLY'||value.source_kind!=='CONTROLLED_LIVE_PILOT'||value.scope_kind!=='FIRST_PACKAGE_WBPA')fail('WBS_INSURANCE_PC_MAPPING_LIVE_OBSERVATION_INVALID','Controlled live observation must remain unsigned and first-package scoped');
  uuid(value.observation_id,'observation_id');for(const key of ['source_evidence_hash','canonical_set_hash'])hash(value[key],key);canonicalUtc(value.captured_at,'captured_at');
  if(!Number.isSafeInteger(value.record_count)||value.record_count<1||!Number.isSafeInteger(value.null_pc_code_row_count)||value.null_pc_code_row_count<0||value.null_pc_code_row_count>value.record_count||!Number.isSafeInteger(value.scope_pc_code_count)||value.scope_pc_code_count<1||value.scope_pc_code_count>value.record_count)fail('WBS_INSURANCE_PC_MAPPING_COUNT_INVALID','Controlled live observation counts are invalid');
  assertZeroActions(value.actions);assertZeroWrites(value.write_delta,'write_delta');
  closed(value.public_dto,['schema_version','observation_id','status','admission_state','source_kind','scope_kind','scope_pc_code_count','source_evidence_hash','canonical_set_hash','captured_at','record_count','null_pc_code_row_count'],'public_dto');
  if(JSON.stringify(value.public_dto).match(/raw|token|secret|credential|storage|signature/i))fail('WBS_INSURANCE_PC_MAPPING_PUBLIC_DTO_UNSAFE','Controlled live DTO contains forbidden raw or signed-admission data');
  for(const key of ['schema_version','observation_id','status','admission_state','source_kind','scope_kind','scope_pc_code_count','source_evidence_hash','canonical_set_hash','captured_at','record_count','null_pc_code_row_count'])if(value.public_dto[key]!==value[key])fail('WBS_INSURANCE_PC_MAPPING_PUBLIC_DTO_INVALID','Controlled live DTO is not bound to the exact observation');
  return freeze(structuredClone(value));
}

export function validateInsuranceFormalAdmissionBinding(value,observation,expectedApproval){
  observation=validateInsurancePreAdmissionObservation(observation);
  expectedApproval=closed(expectedApproval,['mapping_approval_id','canonical_mapping_decision_hash','parent_company_mapping_hash','status','revoked'],'expectedApproval');
  uuid(expectedApproval.mapping_approval_id,'expectedApproval.mapping_approval_id');for(const key of ['canonical_mapping_decision_hash','parent_company_mapping_hash'])hash(expectedApproval[key],key);
  if(expectedApproval.status!=='APPROVED'||expectedApproval.revoked!==false)fail('WBS_INSURANCE_PC_MAPPING_APPROVAL_INVALID','Formal admission requires a current non-revoked Controller approval');
  closed(value,['schema_version','admission_id','controller_mapping_status','mapping_approval_id','approval_revoked','observation_id','observation_hash','proposal_hash','decision_hash','company_mapping_hash','canonical_mapping_decision_hash','parent_company_mapping_hash','receipt_hash','request_hash','artifact_set_hash','package_hash','source_payload_hash','artifacts','provenance','pre_admission_status','formal_admission_allowed','actions'],'formalAdmissionBinding');
  if(value.schema_version!=='REFS_INSURANCE_FORMAL_ADMISSION_BINDING_V1'||value.controller_mapping_status!=='APPROVED'||value.approval_revoked!==false||value.pre_admission_status!=='PRE_ADMISSION_OBSERVATION'||value.formal_admission_allowed!==true||value.observation_id!==observation.observation_id||value.observation_hash!==observation.observation_hash||value.mapping_approval_id!==expectedApproval.mapping_approval_id||value.canonical_mapping_decision_hash!==expectedApproval.canonical_mapping_decision_hash||value.parent_company_mapping_hash!==expectedApproval.parent_company_mapping_hash)fail('WBS_INSURANCE_PC_MAPPING_FORMAL_BINDING_INVALID','Formal admission requires the exact current Controller approval and observation');
  uuid(value.admission_id,'admission_id');
  for(const key of ['observation_hash','proposal_hash','decision_hash','company_mapping_hash','canonical_mapping_decision_hash','parent_company_mapping_hash','receipt_hash','request_hash'])hash(value[key],key);
  if(value.decision_hash!==value.canonical_mapping_decision_hash||value.company_mapping_hash!==value.parent_company_mapping_hash)fail('WBS_INSURANCE_PC_MAPPING_FORMAL_BINDING_INVALID','Formal admission decision and parent mapping hashes must be canonical');
  for(const key of ['artifact_set_hash','package_hash','source_payload_hash'])if(value[key]!==observation[key])fail('WBS_INSURANCE_PC_MAPPING_ARTIFACT_DRIFT','Formal admission artifact hashes drifted from pre-admission');
  closed(value.artifacts,ARTIFACTS,'formalAdmissionBinding.artifacts');for(const name of ARTIFACTS){validateArtifact(value.artifacts[name],name);for(const key of ['storage_version','content_hash','size_bytes','media_type','scan_disposition','scan_hash'])if(value.artifacts[name][key]!==observation.artifacts[name][key])fail('WBS_INSURANCE_PC_MAPPING_ARTIFACT_DRIFT','Formal admission artifact coordinates drifted from pre-admission');}
  closed(value.provenance,['admission_id','observation_id','observation_hash','mapping_approval_id','canonical_mapping_decision_hash','parent_company_mapping_hash','receipt_hash','request_hash','artifact_set_hash','package_hash','source_payload_hash','artifacts'],'formalAdmissionBinding.provenance');
  for(const key of ['admission_id','observation_id','observation_hash','mapping_approval_id','canonical_mapping_decision_hash','parent_company_mapping_hash','receipt_hash','request_hash','artifact_set_hash','package_hash','source_payload_hash'])if(value.provenance[key]!==value[key])fail('WBS_INSURANCE_PC_MAPPING_FORMAL_BINDING_INVALID','Formal receipt/request provenance is not bound to the exact approval and artifact set');
  if(JSON.stringify(value.provenance.artifacts)!==JSON.stringify(value.artifacts))fail('WBS_INSURANCE_PC_MAPPING_FORMAL_BINDING_INVALID','Formal provenance artifact coordinates are not exact');
  if(value.request_hash!==computeInsuranceFormalAdmissionRequestHash(value))fail('WBS_INSURANCE_PC_MAPPING_FORMAL_BINDING_INVALID','Formal request hash is not canonically bound to the approval and exact artifacts');
  if(value.receipt_hash!==computeInsuranceFormalAdmissionReceiptHash(value))fail('WBS_INSURANCE_PC_MAPPING_FORMAL_BINDING_INVALID','Formal receipt hash is not canonically bound to the request, approval, and exact artifacts');
  assertZeroActions(value.actions);return freeze(structuredClone(value));
}

export function assertInsurancePcMappingDto(value,{approved=false,trace=false}={}){
  object(value,'mappingDto');
  const allowed=new Set(['proposal_id','observation_id','revision','status','source_kind','admission_state','observation_hash','proposal_hash','canonical_set_hash','decision_hash','company_mapping_hash','match_count','idempotent','rows','pc_code','company_code','effective_from','effective_to','proposed_by','proposed_at','approved_by','approved_at','reason','catalog_decision_id']);
  if(Object.keys(value).some(key=>!allowed.has(key)))fail('WBS_INSURANCE_PC_MAPPING_PUBLIC_DTO_UNSAFE','Mapping DTO contains an unexpected field');
  for(const key of ['observation_hash','proposal_hash'])hash(value[key],key);
  if(approved)for(const key of ['decision_hash','company_mapping_hash'])hash(value[key],key);
  if(trace&&value.match_count!==1)fail('WBS_INSURANCE_PC_MAPPING_TRACE_INVALID','Approved trace must have exactly one mapping match');
  if(containsForbiddenKey(value))fail('WBS_INSURANCE_PC_MAPPING_PUBLIC_DTO_UNSAFE','Mapping DTO contains forbidden raw transport data');
  return value;
}
