import {createHash} from 'node:crypto';
import {canonicalRequestBody,canonicalRequestHash} from './request-hash.mjs';
import {containsWbsProviderFinal1Credential,verifyWbsProviderFinal1Delivery,verifyWbsProviderFinal1InsuranceDelivery} from './wbs-provider-final1-delivery.mjs';
import {normalizeVerifiedWbsProviderFinal1Payables} from './wbs-provider-final1-payable-normalizer.mjs';
import {normalizeVerifiedWbsProviderFinal1Insurance} from './wbs-provider-final1-insurance-normalizer.mjs';
import {normalizeVerifiedWbsProviderFinal1Business,verifyWbsProviderFinal1BusinessDelivery} from './wbs-provider-final1-business-delivery.mjs';
import {validateInsuranceFormalAdmissionBinding,validateInsurancePreAdmissionObservation} from './wbs-insurance-pc-mapping-controller.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY=/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;
const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_ARTIFACT_BYTES=4*1024*1024;
const MAX_COMBINED_BYTES=7*1024*1024;

export class WbsProviderFinal1RetainedEvidenceError extends Error{
  constructor(code,message){super(message);this.name='WbsProviderFinal1RetainedEvidenceError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsProviderFinal1RetainedEvidenceError(code,message);};
const text=value=>value==null?'':String(value).trim();
const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const deterministicUuid=value=>{const bytes=createHash('sha256').update(value).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;};
const decode=(value,label)=>{
  if(typeof value!=='string'||value.length===0||value.length%4!==0||!BASE64.test(value))fail('WBS_FINAL1_RAW_INVALID',`${label} must be canonical base64.`);
  const bytes=Buffer.from(value,'base64');
  if(bytes.byteLength===0||bytes.byteLength>MAX_ARTIFACT_BYTES||bytes.toString('base64')!==value)fail('WBS_FINAL1_RAW_INVALID',`${label} is absent, oversized, or noncanonical.`);
  return bytes;
};
const packagePreflight=(packageRaw,domain)=>{
  let pkg;try{pkg=JSON.parse(packageRaw.toString('utf8'));}catch{fail('WBS_FINAL1_PACKAGE_INVALID','Final-1 package is not JSON.');}
  if(pkg?.domain!==domain||!DATE.test(pkg?.date_from||'')||!DATE.test(pkg?.date_to||'')||pkg.date_from>pkg.date_to)fail('WBS_FINAL1_PACKAGE_INVALID','Final-1 package domain or date range is invalid.');
  return {dateFrom:pkg.date_from,dateTo:pkg.date_to};
};
const retainedObjectDescriptor=value=>Object.freeze({storage_ref:value.storageRef,storage_version:value.storageVersion,size_bytes:value.sizeBytes,media_type:value.mediaType,content_hash:value.contentHash});
const artifactDescriptor=(value,scan)=>Object.freeze({storage_ref:value.storageRef,storage_version:value.storageVersion,size_bytes:value.sizeBytes,media_type:value.mediaType,content_hash:value.contentHash,retentionMode:value.retentionMode,retainUntil:value.retainUntil,scan_clean:true,scan_ref:scan.scanRef});
const orphanRetained=(cause,{retainedCount,attemptedArtifact,registryPersisted,markerPersisted})=>{const error=new WbsProviderFinal1RetainedEvidenceError('WBS_FINAL1_ORPHAN_RETAINED','Final-1 immutable evidence storage was attempted but all-clean database completion was not established.');Object.defineProperties(error,{cause:{value:cause},retainedCount:{value:retainedCount},attemptedArtifact:{value:attemptedArtifact},registryPersisted:{value:registryPersisted===true},markerPersisted:{value:markerPersisted===true}});return error;};

export function createWbsProviderFinal1RetainedEvidenceAdmission({
  kernel,storage,scanner,providerTrust,principal,serviceActorId,serviceAudience=null,serviceTenantId=null,clock=()=>Date.now(),opsLogger=null,
  verifyPayables=verifyWbsProviderFinal1Delivery,verifyInsurance=verifyWbsProviderFinal1InsuranceDelivery,verifyBusiness=verifyWbsProviderFinal1BusinessDelivery,
  normalizePayables=normalizeVerifiedWbsProviderFinal1Payables,normalizeInsurance=normalizeVerifiedWbsProviderFinal1Insurance,normalizeBusiness=normalizeVerifiedWbsProviderFinal1Business
}={}){
  if(!kernel||typeof kernel.readWbsProviderFinal1AdmissionScope!=='function'||typeof kernel.retainWbsProviderFinal1SourceEvidence!=='function')fail('WBS_FINAL1_PERSISTENCE_REQUIRED','Final-1 scope and atomic persistence kernel are required.');
  if(!storage||typeof storage.putImmutableVersion!=='function'||typeof storage.putOrphanLifecycleMarker!=='function'||typeof storage.inspectImmutableVersion!=='function'||typeof storage.readVerifiedVersion!=='function'||!Number.isInteger(storage.retentionDays))fail('WBS_FINAL1_STORAGE_REQUIRED','Immutable versioned WBS evidence storage, exact-version readback, and durable orphan marker are required.');
  if(!scanner||typeof scanner.scan!=='function')fail('WBS_FINAL1_SCANNER_REQUIRED','A strict exact-version evidence scanner is required.');
  if(!principal?.trusted||!principal.actorId||principal.actorId!==serviceActorId||(serviceTenantId!=null&&principal.tenantId!==serviceTenantId)||(serviceAudience!=null&&(!Array.isArray(principal.audiences)||principal.audiences.length!==1||principal.audiences[0]!==serviceAudience)))fail('WBS_FINAL1_SERVICE_IDENTITY_DENIED','Only the configured authenticated Provider service identity may retain Final-1 evidence.');
  if(!providerTrust||typeof providerTrust.public_key!=='string')fail('WBS_FINAL1_TRUST_REQUIRED','Pinned Provider trust is required.');
  for(const dependency of [verifyPayables,verifyInsurance,verifyBusiness,normalizePayables,normalizeInsurance,normalizeBusiness])if(typeof dependency!=='function')fail('WBS_FINAL1_BOUNDARY_REQUIRED','Final-1 verification and normalization boundaries are required.');
  const recordOrphans=async({tenantId,entityId,admissionId,immutableVersion,domain,receiptHash,retentionUntil,confirmed,failureStage,reasonCode})=>{
    if(Object.keys(confirmed).length===0)return {registryPersisted:false,markerPersisted:false};
    try{
      if(typeof kernel.recordWbsProviderFinal1OrphanRetainedObjects!=='function')throw new Error('orphan registry unavailable');
      const result=await kernel.recordWbsProviderFinal1OrphanRetainedObjects({tenantId,entityId,admissionId,artifacts:Object.freeze({...confirmed}),failureStage,reasonCode});
      if(result?.status!=='WBS_FINAL1_ORPHAN_REGISTRY_RETAINED'||result.object_count!==Object.keys(confirmed).length)throw new Error('Final-1 orphan registry returned an unsafe result');
      return {registryPersisted:true,markerPersisted:false};
    }catch{
      try{const marker=await storage.putOrphanLifecycleMarker({tenantId,entityId,admissionId,immutableVersion,domain,receiptHash,retentionUntil,failureStage,reasonCode,artifacts:Object.freeze({...confirmed})});if(marker?.status!=='WBS_FINAL1_ORPHAN_MARKER_RETAINED'||typeof marker.contentHash!=='string'||typeof marker.storageVersion!=='string')throw new Error('unsafe marker result');opsLogger?.warn?.(JSON.stringify({event:'wbs_final1_orphan_marker_retained',failure_stage:failureStage,reason_code:reasonCode,object_count:Object.keys(confirmed).length,marker_hash:marker.contentHash,marker_version:marker.storageVersion,marker_status:'RETAINED'}));return {registryPersisted:false,markerPersisted:true};}
      catch{opsLogger?.error?.(JSON.stringify({event:'wbs_final1_orphan_persistence_failed',failure_stage:failureStage,reason_code:reasonCode,object_count:Object.keys(confirmed).length,registry_status:'NOT_CONFIRMED',marker_status:'NOT_CONFIRMED'}));return {registryPersisted:false,markerPersisted:false};}
    }
  };
  return Object.freeze({
    mode:'WBS_PROVIDER_FINAL1_RETAINED_EVIDENCE_V1',
    async admit({domain,tenantId,entityId,receipt,requestRawBase64,responseRawBase64,packageRawBase64,idempotencyKey}={}){
      if(!['PAYABLES','INSURANCE','BANK','COST','PROPERTY'].includes(domain)||!UUID.test(text(tenantId))||!UUID.test(text(entityId)))fail('WBS_FINAL1_SCOPE_INVALID','Authenticated tenant, entity, and fixed Final-1 domain are required.');
      if(!IDEMPOTENCY.test(text(idempotencyKey)))fail('WBS_FINAL1_IDEMPOTENCY_REQUIRED','A stable 16-200 character idempotency key is required.');
      const requestRaw=decode(requestRawBase64,'requestRawBase64'),responseRaw=decode(responseRawBase64,'responseRawBase64'),packageRaw=decode(packageRawBase64,'packageRawBase64');
      const receiptRaw=Buffer.from(canonicalRequestBody(receipt),'utf8');
      if(receiptRaw.byteLength<1||requestRaw.byteLength+responseRaw.byteLength+packageRaw.byteLength+receiptRaw.byteLength>MAX_COMBINED_BYTES)fail('WBS_FINAL1_RAW_INVALID','Final-1 artifact set exceeds the controlled admission bound.');
      if([receiptRaw,requestRaw,responseRaw,packageRaw].some(containsWbsProviderFinal1Credential))fail('WBS_FINAL1_BOUNDARY_INVALID','Final-1 artifacts must be credential-free before immutable storage.');
      const {dateFrom,dateTo}=packagePreflight(packageRaw,domain);
      const scope=await kernel.readWbsProviderFinal1AdmissionScope({tenantId,entityId,dateFrom,dateTo});
      if(!scope||scope.active!==true||scope.source_system!=='WBS'||typeof scope.company_code!=='string'||scope.base_currency!=='USD'||typeof scope.company_mapping_hash!=='string')fail('WBS_FINAL1_APPROVED_SCOPE_REQUIRED','An active Controller-approved WBS company/USD mapping is required.');
      let verified,plan;
      try{
        if(domain==='PAYABLES'){
          verified=verifyPayables({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:tenantId,entity_id:entityId,company_code:scope.company_code},expectedCurrency:'USD',now:clock()});
          plan=normalizePayables({verified,expectedCurrency:'USD'});
        }else if(domain==='INSURANCE'){
          verified=verifyInsurance({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:tenantId,entity_id:entityId,company_code:scope.company_code,company_mapping_hash:scope.company_mapping_hash},expectedCurrency:'USD',now:clock()});
          plan=normalizeInsurance({verified,expectedCurrency:'USD'});
        }else{
          verified=verifyBusiness({providerTrust,receipt,requestRaw,responseRaw,packageRaw,expectedScope:{tenant_id:tenantId,entity_id:entityId,company_code:scope.company_code},domain,now:clock()});
          plan=normalizeBusiness({verified});
        }
      }catch(cause){throw new WbsProviderFinal1RetainedEvidenceError(cause?.code||'WBS_FINAL1_VERIFICATION_FAILED','Final-1 verification or normalization failed.');}
      if(verified.signature_verified!==true||verified.raw_contains_credentials!==false||verified.admission_blockers?.length!==0||plan.can_create_draft!==false||plan.can_review!==false||plan.can_approve!==false||plan.can_post!==false||plan.can_propose_amortization===true)fail('WBS_FINAL1_BOUNDARY_INVALID','Final-1 evidence boundary returned an unsafe result.');
      const admissionId=deterministicUuid(`${tenantId}\0${entityId}\0${domain}\0${idempotencyKey}`),receiptHash=canonicalRequestHash(receipt),retentionUntil=new Date(clock()+storage.retentionDays*86400000).toISOString();
      const inputs=[
        ['receipt','receipt.json',receiptRaw,receiptHash],['request','request.raw',requestRaw,sha256(requestRaw)],
        ['response','response.raw',responseRaw,sha256(responseRaw)],['package','package.json',packageRaw,sha256(packageRaw)]
      ];
      const artifacts={},confirmed={};let retainedCount=0,attemptedArtifact=null;
      try{for(const [name,artifact,bytes,expectedHash] of inputs){
        attemptedArtifact=artifact;
        const stored=await storage.putImmutableVersion({tenantId,entityId,admissionId,immutableVersion:verified.snapshot_id,domain,artifact,bytes,expectedHash,receiptHash,retentionUntil});retainedCount++;confirmed[name]=retainedObjectDescriptor(stored);
        const scan=await scanner.scan({tenantId,entityId,admissionId,artifact,storageRef:stored.storageRef,storageVersion:stored.storageVersion,sizeBytes:stored.sizeBytes,contentHash:stored.contentHash,mediaType:stored.mediaType});
        const expectedScanRef=`clamav:${stored.contentHash.slice(7)}:clean`;
        if(scan?.clean!==true||scan.scanRef!==expectedScanRef)fail('WBS_FINAL1_SCAN_NOT_CLEAN','Every exact immutable Final-1 artifact version must have a hash-bound clean scan before persistence.');
        artifacts[name]=artifactDescriptor(stored,scan);
      }}catch(cause){const reasonCode=cause?.code==='WBS_FINAL1_SCAN_NOT_CLEAN'?'WBS_FINAL1_SCAN_NOT_CLEAN':'WBS_FINAL1_STORAGE_OR_SCAN_FAILED';const persisted=await recordOrphans({tenantId,entityId,admissionId,immutableVersion:verified.snapshot_id,domain,receiptHash,retentionUntil,confirmed,failureStage:'STORAGE_OR_SCAN',reasonCode});throw orphanRetained(cause,{retainedCount,attemptedArtifact,...persisted});}
      if(domain==='INSURANCE'){
        if(typeof kernel.recordWbsInsurancePcMappingPreAdmission!=='function'||typeof kernel.getWbsInsurancePcMappingTrace!=='function')fail('WBS_INSURANCE_PRE_ADMISSION_PERSISTENCE_REQUIRED','Insurance Final-1 requires the Controller pre-admission recorder and trace reader.');
        const countByPc=new Map();let nullPcCodeRowCount=0;
        for(const row of plan.evidence_rows){const pc=row.normalized?.pcCode;if(pc==null){nullPcCodeRowCount++;continue;}countByPc.set(pc,(countByPc.get(pc)||0)+1);}
        const aggregateRows=[...countByPc].sort(([a],[b])=>a.localeCompare(b)).map(([pc_code,observed_row_count])=>Object.freeze({pc_code,observed_row_count,row_hash:canonicalRequestHash({pc_code,observed_row_count})}));
        if(aggregateRows.length===0)fail('WBS_INSURANCE_PRE_ADMISSION_EMPTY','Insurance pre-admission requires at least one signed non-null PC code.');
        const exactArtifacts=Object.fromEntries(Object.entries(artifacts).map(([name,value])=>[name,Object.freeze({storage_ref:value.storage_ref,storage_version:value.storage_version,content_hash:value.content_hash,size_bytes:value.size_bytes,media_type:value.media_type,object_lock_mode:value.retentionMode,retain_until:new Date(value.retainUntil).toISOString(),scan_disposition:'CLEAN',scan_ref:value.scan_ref,scan_hash:value.content_hash})]));
        const actions=Object.freeze({can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false}),write_delta=Object.freeze({admission:0,retention:0,coverage:0,staging:0,journal_entry:0,ledger:0,audit:0,outbox:0,model_call:0,storage_action:0});
        const capturedAt=new Date(verified.package?.captured_at||receipt.signed_at).toISOString(),observationId=deterministicUuid(`${admissionId}\0insurance-pc-mapping-observation`),canonicalSetHash=canonicalRequestHash({pc_codes:aggregateRows.map(({pc_code,observed_row_count})=>({pc_code,observed_row_count}))}),artifactSetHash=canonicalRequestHash(exactArtifacts);
        const publicBase={schema_version:'REFS_INSURANCE_PRE_ADMISSION_OBSERVATION_V1',observation_id:observationId,status:'PRE_ADMISSION_OBSERVATION',admission_state:'NOT_ADMITTED',source_kind:'PRE_ADMISSION_OBSERVATION',source_evidence_hash:plan.plan_hash,scope_kind:'FIRST_PACKAGE_WBPA',scope_pc_code_count:aggregateRows.length,artifact_set_hash:artifactSetHash,package_hash:verified.package_hash,source_payload_hash:verified.raw_package_hash,canonical_set_hash:canonicalSetHash,captured_at:capturedAt,record_count:plan.evidence_rows.length,null_pc_code_row_count:nullPcCodeRowCount};
        const hashBase={...publicBase,admission_id:admissionId,immutable_version:verified.snapshot_id,receipt_hash:receiptHash,date_from:dateFrom,date_to:dateTo,signature_algorithm:'Ed25519',signature_verified:true,artifacts:exactArtifacts,actions,write_delta,public_dto:publicBase},observationHash=canonicalRequestHash(hashBase);
        const observation=validateInsurancePreAdmissionObservation(Object.freeze({...hashBase,observation_hash:observationHash,public_dto:Object.freeze({...publicBase,observation_hash:observationHash})}));
        const recorded=await kernel.recordWbsInsurancePcMappingPreAdmission({tenantId,entityId,observation,rows:aggregateRows});
        // Phase A is terminal for this command. It returns a durable NOT_ADMITTED
        // observation/resume receipt and never turns a mapping that happened to exist
        // concurrently into an admission. Phase B is the only admission command.
        return Object.freeze(recorded);
      }
      const delivery=Object.freeze({
        admission_id:admissionId,domain,issuer:receipt.issuer,key_id:receipt.kid,algorithm:'Ed25519',nonce:receipt.nonce,
        company_code:scope.company_code,...(domain==='INSURANCE'?{company_mapping_hash:scope.company_mapping_hash}:{}),
        signed_at:receipt.signed_at,expires_at:receipt.expires_at,observation_at:verified.package?.captured_at||receipt.signed_at,source_tool:verified.source_tool||null,
        date_from:verified.date_from,date_to:verified.date_to,snapshot_id:verified.snapshot_id,row_count:verified.row_count,
        control_totals:verified.control_totals,control_totals_hash:verified.control_totals_hash,
        receipt_hash:receiptHash,request_raw_hash:sha256(requestRaw),response_raw_hash:sha256(responseRaw),package_raw_hash:sha256(packageRaw),package_hash:verified.package_hash,
        plan_hash:plan.plan_hash,signature_verified:true
      });
      let result;try{result=await kernel.retainWbsProviderFinal1SourceEvidence({tenantId,entityId,delivery,artifacts:Object.freeze(artifacts),plan,idempotencyKey});if(!result||result.status!=='WBS_FINAL1_RETAINED_SOURCE_EVIDENCE'||result.signature_verified!==true||result.domain!==domain||result.admission_id!==admissionId||result.can_write_wbs!==false||result.can_propose_amortization!==false||result.can_create_draft!==false||result.can_review!==false||result.can_approve!==false||result.can_post!==false)fail('WBS_FINAL1_RESULT_INVALID','Final-1 atomic retention returned an unsafe result.');}catch(cause){const persisted=await recordOrphans({tenantId,entityId,admissionId,immutableVersion:verified.snapshot_id,domain,receiptHash,retentionUntil,confirmed,failureStage:'DATABASE_COMPLETION',reasonCode:'WBS_FINAL1_DATABASE_COMPLETION_FAILED'});throw orphanRetained(cause,{retainedCount,attemptedArtifact:'database-completion',...persisted});}
      return Object.freeze(result);
    },
    async resumeInsurance({tenantId,entityId,observationId,expectedObservationHash,expectedApprovalId,expectedDecisionHash,expectedCompanyMappingHash,reason,idempotencyKey}={}){
      if(!UUID.test(text(tenantId))||!UUID.test(text(entityId))||!UUID.test(text(observationId))||!UUID.test(text(expectedApprovalId)))fail('WBS_FINAL1_SCOPE_INVALID','Authenticated tenant/entity and exact observation/approval ids are required.');
      if(!/^sha256:[0-9a-f]{64}$/.test(text(expectedObservationHash))||!/^sha256:[0-9a-f]{64}$/.test(text(expectedDecisionHash))||!/^sha256:[0-9a-f]{64}$/.test(text(expectedCompanyMappingHash)))fail('WBS_INSURANCE_RESUME_HASH_INVALID','Exact observation, decision, and company mapping hashes are required.');
      if(!IDEMPOTENCY.test(text(idempotencyKey))||typeof reason!=='string'||reason.trim().length<8||reason.trim().length>2000)fail('WBS_FINAL1_IDEMPOTENCY_REQUIRED','A stable idempotency key and controlled reason are required.');
      if(typeof kernel.readWbsInsurancePcMappingAdmissionResume!=='function')fail('WBS_INSURANCE_RESUME_PERSISTENCE_REQUIRED','The server-owned Insurance admission resume reader is required.');
      const resume=await kernel.readWbsInsurancePcMappingAdmissionResume({tenantId,entityId,observationId,expectedObservationHash,expectedApprovalId,expectedDecisionHash,expectedCompanyMappingHash});
      const observation=validateInsurancePreAdmissionObservation(resume?.observation);
      if(observation.observation_id!==observationId||observation.observation_hash!==expectedObservationHash)fail('WBS_INSURANCE_RESUME_DRIFT','The durable Phase A observation changed.');
      const approval=resume?.approval;
      if(!approval||approval.mapping_approval_id!==expectedApprovalId||approval.canonical_mapping_decision_hash!==expectedDecisionHash||approval.parent_company_mapping_hash!==expectedCompanyMappingHash||approval.status!=='APPROVED'||approval.revoked!==false)fail('WBS_INSURANCE_RESUME_APPROVAL_INVALID','The exact Controller approval is absent, changed, expired, or revoked.');
      const buffers={},rescanned={};
      for(const [name,artifact] of Object.entries(observation.artifacts)){
        const artifactName=name==='receipt'?'receipt.json':name==='package'?'package.json':`${name}.raw`;
        await storage.inspectImmutableVersion(artifact.storage_ref,artifact.storage_version,{tenantId,entityId,immutableVersion:resume.immutable_version,domain:'INSURANCE',artifact:artifactName,receiptHash:resume.receipt_hash,contentHash:artifact.content_hash,sizeBytes:artifact.size_bytes,mediaType:artifact.media_type,retentionUntil:artifact.retain_until});
        const bytes=Buffer.from(await storage.readVerifiedVersion({storageRef:artifact.storage_ref,storageVersion:artifact.storage_version,expectedHash:artifact.content_hash,maxBytes:MAX_ARTIFACT_BYTES}));
        if(bytes.byteLength!==artifact.size_bytes)fail('WBS_INSURANCE_RESUME_DRIFT','The exact stored artifact size changed.');
        const scan=await scanner.scan({tenantId,entityId,admissionId:resume.admission_id,artifact:artifactName,storageRef:artifact.storage_ref,storageVersion:artifact.storage_version,sizeBytes:artifact.size_bytes,contentHash:artifact.content_hash,mediaType:artifact.media_type});
        if(scan?.clean!==true||scan.scanRef!==artifact.scan_ref)fail('WBS_INSURANCE_RESUME_SCAN_DRIFT','The exact retained artifact no longer has the approved hash-bound CLEAN scan.');
        buffers[name]=bytes;rescanned[name]=artifact;
      }
      let receipt;try{receipt=JSON.parse(buffers.receipt.toString('utf8'));}catch{fail('WBS_INSURANCE_RESUME_DRIFT','The retained receipt is not valid JSON.');}
      const scope=await kernel.readWbsProviderFinal1AdmissionScope({tenantId,entityId,dateFrom:resume.date_from,dateTo:resume.date_to});
      if(!scope||scope.active!==true||scope.source_system!=='WBS'||scope.company_code!=='WBPA'||scope.base_currency!=='USD'||scope.company_mapping_hash!==expectedCompanyMappingHash)fail('WBS_FINAL1_APPROVED_SCOPE_REQUIRED','The exact active WBPA/USD company mapping changed.');
      let verified,plan;try{
        verified=verifyInsurance({providerTrust,receipt,requestRaw:buffers.request,responseRaw:buffers.response,packageRaw:buffers.package,expectedScope:{tenant_id:tenantId,entity_id:entityId,company_code:'WBPA',company_mapping_hash:expectedCompanyMappingHash},expectedCurrency:'USD',now:clock()});
        plan=normalizeInsurance({verified,expectedCurrency:'USD'});
      }catch(cause){throw new WbsProviderFinal1RetainedEvidenceError(cause?.code||'WBS_FINAL1_VERIFICATION_FAILED','Retained Insurance evidence verification failed.');}
      const bindingBase={schema_version:'REFS_INSURANCE_FORMAL_ADMISSION_BINDING_V1',admission_id:resume.admission_id,controller_mapping_status:'APPROVED',mapping_approval_id:expectedApprovalId,approval_revoked:false,observation_id:observationId,observation_hash:expectedObservationHash,proposal_hash:approval.proposal_hash,decision_hash:expectedDecisionHash,company_mapping_hash:expectedCompanyMappingHash,canonical_mapping_decision_hash:expectedDecisionHash,parent_company_mapping_hash:expectedCompanyMappingHash,artifact_set_hash:observation.artifact_set_hash,package_hash:observation.package_hash,source_payload_hash:observation.source_payload_hash,artifacts:rescanned,pre_admission_status:'PRE_ADMISSION_OBSERVATION',formal_admission_allowed:true,actions:{can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false}};
      const requestHash=canonicalRequestHash({schema_version:'REFS_INSURANCE_FORMAL_ADMISSION_REQUEST_V1',admission_id:bindingBase.admission_id,observation_id:bindingBase.observation_id,observation_hash:bindingBase.observation_hash,proposal_hash:bindingBase.proposal_hash,mapping_approval_id:bindingBase.mapping_approval_id,canonical_mapping_decision_hash:bindingBase.canonical_mapping_decision_hash,parent_company_mapping_hash:bindingBase.parent_company_mapping_hash,artifact_set_hash:bindingBase.artifact_set_hash,package_hash:bindingBase.package_hash,source_payload_hash:bindingBase.source_payload_hash,artifacts:bindingBase.artifacts});
      const receiptHash=canonicalRequestHash({schema_version:'REFS_INSURANCE_FORMAL_ADMISSION_RECEIPT_V1',admission_id:bindingBase.admission_id,request_hash:requestHash,observation_id:bindingBase.observation_id,observation_hash:bindingBase.observation_hash,mapping_approval_id:bindingBase.mapping_approval_id,canonical_mapping_decision_hash:bindingBase.canonical_mapping_decision_hash,parent_company_mapping_hash:bindingBase.parent_company_mapping_hash,artifact_set_hash:bindingBase.artifact_set_hash,artifacts:bindingBase.artifacts});
      const provenance={admission_id:bindingBase.admission_id,observation_id:bindingBase.observation_id,observation_hash:bindingBase.observation_hash,mapping_approval_id:bindingBase.mapping_approval_id,canonical_mapping_decision_hash:bindingBase.canonical_mapping_decision_hash,parent_company_mapping_hash:bindingBase.parent_company_mapping_hash,receipt_hash:receiptHash,request_hash:requestHash,artifact_set_hash:bindingBase.artifact_set_hash,package_hash:bindingBase.package_hash,source_payload_hash:bindingBase.source_payload_hash,artifacts:bindingBase.artifacts};
      const binding=validateInsuranceFormalAdmissionBinding({...bindingBase,request_hash:requestHash,receipt_hash:receiptHash,provenance},observation,{mapping_approval_id:approval.mapping_approval_id,canonical_mapping_decision_hash:approval.canonical_mapping_decision_hash,parent_company_mapping_hash:approval.parent_company_mapping_hash,status:approval.status,revoked:approval.revoked});
      const delivery=Object.freeze({admission_id:resume.admission_id,domain:'INSURANCE',issuer:receipt.issuer,key_id:receipt.kid,algorithm:'Ed25519',nonce:receipt.nonce,company_code:'WBPA',company_mapping_hash:expectedCompanyMappingHash,mapping_approval_id:expectedApprovalId,canonical_mapping_decision_hash:expectedDecisionHash,parent_company_mapping_hash:expectedCompanyMappingHash,observation_id:observationId,observation_hash:expectedObservationHash,formal_admission_request_hash:requestHash,formal_admission_receipt_hash:receiptHash,signed_at:receipt.signed_at,expires_at:receipt.expires_at,observation_at:verified.package?.captured_at||receipt.signed_at,date_from:verified.date_from,date_to:verified.date_to,snapshot_id:verified.snapshot_id,row_count:verified.row_count,receipt_hash:resume.receipt_hash,request_raw_hash:sha256(buffers.request),response_raw_hash:sha256(buffers.response),package_raw_hash:sha256(buffers.package),package_hash:verified.package_hash,plan_hash:plan.plan_hash,signature_verified:true});
      const result=await kernel.retainWbsProviderFinal1SourceEvidence({tenantId,entityId,delivery,artifacts:Object.freeze(rescanned),plan:Object.freeze({...plan,formal_admission_binding:binding}),idempotencyKey});
      if(!result||result.status!=='WBS_FINAL1_RETAINED_SOURCE_EVIDENCE'||result.admission_id!==resume.admission_id)fail('WBS_FINAL1_RESULT_INVALID','Formal Insurance admission returned an unsafe result.');
      return Object.freeze(result);
    }
  });
}
