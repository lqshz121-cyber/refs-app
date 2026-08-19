import {KernelError,requireRow,withSerializableRetry} from './db.mjs';
import {canonicalRequestHash} from './request-hash.mjs';
import {validateWbsSnapshotPackage} from './wbs-snapshot-package.mjs';
import {validateWbsAutoRecTransitionContract} from './wbs-autorec-transition-contract.mjs';
import {validateWbsSignedBankAdmission} from './wbs-signed-bank-admission.mjs';

function assertTrustedSession(session){
  if(!session||session.trusted!==true||typeof session.contextToken!=='string'||session.contextToken.length<32)throw new KernelError('TRUSTED_SESSION_REQUIRED','Kernel session requires an opaque DB-issued context token from authenticated middleware');
  return session;
}

// node-postgres materializes PostgreSQL DATE values as local-midnight Date
// objects in this runtime.  JSON serialization would turn those values into
// timestamps (and can shift their calendar day), while the public accounting
// read contract deliberately exposes ISO calendar dates only.
function publicDate(value){
  if(!(value instanceof Date))return value;
  return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
}

export class PostgresAccountingKernel{
  constructor(pool,{sessionProvider,runtimeLoginAllowlist=['refs_runtime'],wbsSnapshotVerifier=null,wbsAutoRecTransitionContractVerifier=null,wbsSignedBankAdmissionVerifier=null}={}){
    if(typeof sessionProvider!=='function')throw new KernelError('SESSION_PROVIDER_REQUIRED','A trusted session provider is required');
    this.pool=pool;this.sessionProvider=sessionProvider;this.runtimeLoginAllowlist=new Set(runtimeLoginAllowlist);
    this.wbsSnapshotVerifier=wbsSnapshotVerifier;this.wbsAutoRecTransitionContractVerifier=wbsAutoRecTransitionContractVerifier;this.wbsSignedBankAdmissionVerifier=wbsSignedBankAdmissionVerifier;
  }

  async inSession(work){
    const session=assertTrustedSession(await this.sessionProvider());
    return withSerializableRetry(this.pool,async client=>{
      const identity=requireRow(await client.query(`SELECT session_user,current_user,
        COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname=session_user),false) AS is_superuser`),'DB_IDENTITY_MISSING','Database identity is unavailable');
      if(!this.runtimeLoginAllowlist.has(identity.session_user)||identity.current_user!==identity.session_user||identity.is_superuser){
        throw new KernelError('DB_RUNTIME_IDENTITY_DENIED','Runtime connection must use an approved non-superuser login');
      }
      await client.query('SET LOCAL ROLE refs_app');
      await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);
      return work(client,session);
    });
  }

  async readControlledDemoTenant({tenantId}){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT * FROM refs_read_controlled_demo_tenant($1)',[tenantId]
    ),'CONTROLLED_DEMO_TENANT_NOT_FOUND','Controlled DEMO tenant status is unavailable'));
  }

  async updateDraftDescription({tenantId,entityId,journalEntryId,expectedRevision,description,idempotencyKey,requestHash}){
    requestHash=canonicalRequestHash({tenantId,entityId,journalEntryId,expectedRevision,description});
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_update_draft_description($1,$2,$3,$4,$5,$6,$7) AS result',
        [tenantId,entityId,journalEntryId,expectedRevision,description,idempotencyKey,requestHash]
      ),'EDIT_FAILED','Draft edit did not return a result');
      return row.result;
    });
  }

  async createManualJournal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_manual_journal_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',
        [args.tenantId,args.entityId,args.periodId,args.journalNumber,args.journalDate,args.currency,args.description??null,JSON.stringify(args.lines),args.attachmentIds]
      ),'JOURNAL_CREATE_HASH_FAILED','Manual journal hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_manual_journal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [args.tenantId,args.entityId,args.periodId,args.journalNumber,args.journalDate,args.currency,args.description??null,JSON.stringify(args.lines),args.attachmentIds,args.idempotencyKey,requestHash]
      ),'JOURNAL_CREATE_FAILED','Manual journal creation did not return a result');
      return row.result;
    });
  }

  async createBusinessDocument(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_business_document_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS request_hash',
        [args.tenantId,args.entityId,args.documentKind,args.periodId,args.documentNumber,args.counterpartyRef,args.counterpartyName,args.currency,args.accountingDate,args.dueDate??null,args.amount,args.offsetAccountCode,args.description??null,args.attachmentIds]
      ),'BUSINESS_DOCUMENT_CREATE_HASH_FAILED','Business document hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_create_business_document($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS result',
        [args.tenantId,args.entityId,args.documentKind,args.periodId,args.documentNumber,args.counterpartyRef,args.counterpartyName,args.currency,args.accountingDate,args.dueDate??null,args.amount,args.offsetAccountCode,args.description??null,args.attachmentIds,args.idempotencyKey,requestHash]
      ),'BUSINESS_DOCUMENT_CREATE_FAILED','Business document Draft creation did not return a result').result;
    });
  }

  async createWbsTestPayableDraft({tenantId,entityId,periodId,observation,row,rowIndex,idempotencyKey}){
    return this.inSession(async client=>{
      const payload=[tenantId,entityId,periodId,JSON.stringify(observation),JSON.stringify(row),rowIndex];
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_wbs_test_payable_draft_hash($1,$2,$3,$4::jsonb,$5::jsonb,$6) AS request_hash',payload
      ),'WBS_TEST_IMPORT_HASH_FAILED','WBS test Payable import hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_create_wbs_test_payable_draft($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) AS result',
        [...payload,idempotencyKey,requestHash]
      ),'WBS_TEST_IMPORT_FAILED','WBS test Payable Draft was not created').result;
    });
  }

  async createWbsControlledTestBankScope({tenantId,entityId,periodId,companyCode,observation,bankAccountRef,idempotencyKey}){
    return this.inSession(async client=>{
      const payload=[tenantId,entityId,periodId,companyCode,JSON.stringify(observation),bankAccountRef];
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_wbs_controlled_test_bank_scope_hash($1,$2,$3,$4,$5::jsonb,$6) AS request_hash',payload
      ),'WBS_TEST_BANK_HASH_FAILED','Controlled test Bank import hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_create_wbs_controlled_test_bank_scope($1,$2,$3,$4,$5::jsonb,$6,$7,$8) AS result',
        [...payload,idempotencyKey,requestHash]
      ),'WBS_TEST_BANK_IMPORT_FAILED','Controlled test Bank scope was not created').result;
    });
  }

  async finalizeWbsTestImportSource({tenantId,entityId,sourceDocumentId,businessDocumentId,journalEntryId,idempotencyKey}){
    return this.inSession(async client=>{
      const payload=[tenantId,entityId,sourceDocumentId,businessDocumentId,journalEntryId];
      const requestHash=requireRow(await client.query(
        'SELECT refs_finalize_wbs_test_import_source_hash($1,$2,$3,$4,$5) AS request_hash',payload
      ),'WBS_TEST_FINALIZE_HASH_FAILED','WBS test source finalization hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_finalize_wbs_test_import_source($1,$2,$3,$4,$5,$6,$7) AS result',
        [...payload,idempotencyKey,requestHash]
      ),'WBS_TEST_FINALIZE_FAILED','WBS test source was not finalized').result;
    });
  }

  async deriveControlledTestAiSource({tenantId,entityId,parentSourceDocumentId,initiatedBy,idempotencyKey}){
    return this.inSession(async client=>{
      const payload=[tenantId,entityId,parentSourceDocumentId,initiatedBy];
      const requestHash=requireRow(await client.query(
        'SELECT refs_derive_controlled_test_ai_source_hash($1,$2,$3,$4) AS request_hash',payload
      ),'CONTROLLED_TEST_AI_SOURCE_HASH_FAILED','Controlled-test AI source hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_derive_controlled_test_ai_source($1,$2,$3,$4,$5,$6) AS result',
        [...payload,idempotencyKey,requestHash]
      ),'CONTROLLED_TEST_AI_SOURCE_FAILED','Controlled-test AI source was not derived').result;
    });
  }

  async reserveAttachment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_attachment_reserve_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [args.tenantId,args.entityId,args.name,args.mediaType,args.sizeBytes,args.contentHash,args.storageRef,args.storageVersion]
      ),'ATTACHMENT_RESERVE_HASH_FAILED','Attachment reserve hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_reserve_attachment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [args.tenantId,args.entityId,args.name,args.mediaType,args.sizeBytes,args.contentHash,args.storageRef,args.storageVersion,args.idempotencyKey,requestHash]
      ),'ATTACHMENT_RESERVE_FAILED','Attachment reservation did not return a result').result;
    });
  }

  async reserveWbsPayableAttachment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_reserve_wbs_payable_attachment_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',
        [args.tenantId,args.entityId,args.wbsInboundRowId,args.name,args.mediaType,args.sizeBytes,args.contentHash,args.storageRef,args.storageVersion]
      ),'WBS_PAYABLE_ATTACHMENT_RESERVE_HASH_FAILED','Row-bound attachment reservation hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_reserve_wbs_payable_attachment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [args.tenantId,args.entityId,args.wbsInboundRowId,args.name,args.mediaType,args.sizeBytes,args.contentHash,
          args.storageRef,args.storageVersion,args.idempotencyKey,requestHash]
      ),'WBS_PAYABLE_ATTACHMENT_RESERVE_FAILED','Row-bound WBS Payable attachment reservation did not return a result').result;
    });
  }

  async finalizeAttachment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_attachment_finalize_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',
        [args.tenantId,args.entityId,args.attachmentId,args.storageRef,args.observedSizeBytes,args.observedContentHash,args.observedMediaType,args.storageVersion,args.scanClean,args.scanRef]
      ),'ATTACHMENT_FINALIZE_HASH_FAILED','Attachment finalize hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_finalize_attachment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
        [args.tenantId,args.entityId,args.attachmentId,args.storageRef,args.observedSizeBytes,args.observedContentHash,args.observedMediaType,args.storageVersion,args.scanClean,args.scanRef,args.idempotencyKey,requestHash]
      ),'ATTACHMENT_FINALIZE_FAILED','Attachment finalization did not return a result').result;
    });
  }

  async requestAttachmentFinalize({tenantId,entityId,attachmentId,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_attachment_finalize_request_hash($1,$2,$3) AS request_hash',[tenantId,entityId,attachmentId]),'ATTACHMENT_FINALIZE_REQUEST_HASH_FAILED','Attachment finalize request hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_request_attachment_finalize($1,$2,$3,$4,$5) AS result',[tenantId,entityId,attachmentId,idempotencyKey,requestHash]),'ATTACHMENT_NOT_FOUND','Attachment was not found').result;
    });
  }

  async claimExpiredAttachments({tenantId,entityId,limit=25}){return this.inSession(async client=>(await client.query('SELECT refs_claim_expired_attachments($1,$2,$3) AS items',[tenantId,entityId,limit])).rows[0].items);}
  async completeAttachmentCleanup({tenantId,entityId,attachmentId,claimToken,deleted,errorCode=null,errorCategory=null}){return this.inSession(async client=>(await client.query('SELECT refs_complete_attachment_cleanup($1,$2,$3,$4,$5,$6,$7) AS result',[tenantId,entityId,attachmentId,claimToken,deleted,errorCode,errorCategory])).rows[0].result);}

  async recordWbsSnapshot({tenantId,entityId,snapshot,idempotencyKey}){
    const validated=validateWbsSnapshotPackage(snapshot);
    if(validated.environment==='PRODUCTION'){
      if(typeof this.wbsSnapshotVerifier!=='function')throw new KernelError('WBS_SNAPSHOT_SIGNATURE_REQUIRED','Production WBS snapshot imports require a configured detached-signature verifier');
      let verified=false;
      try{verified=await this.wbsSnapshotVerifier(snapshot);}
      catch{throw new KernelError('WBS_SNAPSHOT_SIGNATURE_INVALID','Production WBS snapshot signature verification failed');}
      if(verified!==true)throw new KernelError('WBS_SNAPSHOT_SIGNATURE_INVALID','Production WBS snapshot signature verification failed');
    }
    return this.inSession(async client=>{
      const deliveryAttestation=validated.delivery_attestation===null?null:JSON.stringify(validated.delivery_attestation);
      const requestHash=requireRow(await client.query(
        'SELECT refs_wbs_snapshot_import_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',
        [tenantId,entityId,validated.snapshot_id,validated.captured_at,validated.environment,validated.dictionary_version,validated.package_hash,JSON.stringify(validated.receipts),deliveryAttestation]
      ),'WBS_SNAPSHOT_HASH_FAILED','WBS snapshot import hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_record_wbs_snapshot_receipts($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [tenantId,entityId,validated.snapshot_id,validated.captured_at,validated.environment,validated.dictionary_version,validated.package_hash,JSON.stringify(validated.receipts),deliveryAttestation,idempotencyKey,requestHash]
      ),'WBS_SNAPSHOT_IMPORT_FAILED','WBS snapshot import did not return a result').result;
    });
  }

  async retainWbsCompanyCatalogCandidate({tenantId,entityId,catalog,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_retain_wbs_company_catalog_hash($1,$2,$3::jsonb) AS request_hash',[tenantId,entityId,JSON.stringify(catalog)]),'WBS_COMPANY_CATALOG_HASH_FAILED','Company catalog request hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_retain_wbs_company_catalog($1,$2,$3::jsonb,$4,$5) AS result',[tenantId,entityId,JSON.stringify(catalog),idempotencyKey,requestHash]),'WBS_COMPANY_CATALOG_RETAIN_FAILED','Company catalog retention did not return a result').result;
    });
  }

  async listWbsCompanyCatalogCandidates({tenantId,entityId,limit=50,offset=0}){
    return this.inSession(async client=>requireRow(await client.query('SELECT refs_read_wbs_company_catalogs($1,$2,$3,$4) AS rows',[tenantId,entityId,limit,offset]),'WBS_COMPANY_CATALOG_READ_FAILED','Company catalog read did not return a result').rows);
  }

  async listWbsCompanyCatalogRows({tenantId,entityId,candidateId,limit=50,offset=0}){
    return this.inSession(async client=>requireRow(await client.query('SELECT refs_read_wbs_company_catalog_rows($1,$2,$3,$4,$5) AS rows',[tenantId,entityId,candidateId,limit,offset]),'WBS_COMPANY_CATALOG_READ_FAILED','Company catalog row read did not return a result').rows);
  }

  async classifyWbsCompanyCatalogRow({tenantId,entityId,rowId,expectedRevision,classification,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_classify_wbs_company_catalog_hash($1,$2,$3,$4,$5::jsonb,$6) AS request_hash',[tenantId,entityId,rowId,expectedRevision,JSON.stringify(classification),reason]),'WBS_COMPANY_CLASSIFICATION_HASH_FAILED','Company classification request hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_classify_wbs_company_catalog_row($1,$2,$3,$4,$5::jsonb,$6,$7,$8) AS result',[tenantId,entityId,rowId,expectedRevision,JSON.stringify(classification),reason,idempotencyKey,requestHash]),'WBS_COMPANY_CLASSIFICATION_FAILED','Company classification did not return a result').result;
    });
  }

  async approveWbsCompanyCatalogRow({tenantId,entityId,rowId,expectedRevision,expectedCatalogHash,expectedRowHash,effectiveFrom,effectiveTo,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const params=[tenantId,entityId,rowId,expectedRevision,expectedCatalogHash,expectedRowHash,effectiveFrom,effectiveTo??null,reason];
      const requestHash=requireRow(await client.query('SELECT refs_approve_wbs_company_catalog_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',params),'WBS_COMPANY_APPROVAL_HASH_FAILED','Company approval request hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_approve_wbs_company_catalog_row($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',[...params,idempotencyKey,requestHash]),'WBS_COMPANY_APPROVAL_FAILED','Company approval did not return a result').result;
    });
  }

  async createWbsInsurancePcMappingProposal({tenantId,entityId,observationId,expectedObservationHash,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const params=[tenantId,entityId,observationId,expectedObservationHash,reason];
      const requestHash=requireRow(await client.query('SELECT refs_propose_wbs_insurance_pc_mapping_hash($1,$2,$3,$4,$5) AS request_hash',params),'WBS_INSURANCE_PC_MAPPING_PROPOSAL_HASH_FAILED','Insurance PC mapping proposal hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_create_wbs_insurance_pc_mapping_proposal($1,$2,$3,$4,$5,$6,$7) AS result',[...params,idempotencyKey,requestHash]),'WBS_INSURANCE_PC_MAPPING_PROPOSAL_FAILED','Insurance PC mapping proposal did not return a result').result;
    });
  }

  async recordWbsInsurancePcMappingPreAdmission({tenantId,entityId,observation,rows}){
    return this.inSession(async client=>requireRow(await client.query('SELECT refs_record_wbs_insurance_pc_mapping_pre_admission($1,$2,$3::jsonb,$4::jsonb) AS result',[tenantId,entityId,JSON.stringify(observation),JSON.stringify(rows)]),'WBS_INSURANCE_PRE_ADMISSION_RECORD_FAILED','Insurance pre-admission observation was not recorded').result);
  }

  async readWbsInsurancePcMappingAdmissionResume({tenantId,entityId,observationId,expectedObservationHash,expectedApprovalId,expectedDecisionHash,expectedCompanyMappingHash}){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_insurance_pc_mapping_admission_resume($1,$2,$3,$4,$5,$6,$7) AS result',
      [tenantId,entityId,observationId,expectedObservationHash,expectedApprovalId,expectedDecisionHash,expectedCompanyMappingHash]
    ),'WBS_INSURANCE_RESUME_NOT_FOUND','The exact approved Insurance pre-admission observation is unavailable').result);
  }

  async approveWbsInsurancePcMappingProposal({tenantId,entityId,proposalId,expectedRevision,expectedObservationHash,expectedProposalHash,catalogDecisionId,expectedCompanyMappingHash,effectiveFrom,effectiveTo,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const params=[tenantId,entityId,proposalId,expectedRevision,expectedObservationHash,expectedProposalHash,catalogDecisionId,expectedCompanyMappingHash,effectiveFrom,effectiveTo??null,reason];
      const requestHash=requireRow(await client.query('SELECT refs_approve_wbs_insurance_pc_mapping_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS request_hash',params),'WBS_INSURANCE_PC_MAPPING_APPROVAL_HASH_FAILED','Insurance PC mapping approval hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_approve_wbs_insurance_pc_mapping_proposal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',[...params,idempotencyKey,requestHash]),'WBS_INSURANCE_PC_MAPPING_APPROVAL_FAILED','Insurance PC mapping approval did not return a result').result;
    });
  }

  async getWbsInsurancePcMappingProposal({tenantId,entityId,proposalId}){
    return this.inSession(async client=>requireRow(await client.query('SELECT refs_read_wbs_insurance_pc_mapping_proposal($1,$2,$3) AS result',[tenantId,entityId,proposalId]),'WBS_INSURANCE_PC_MAPPING_PROPOSAL_NOT_FOUND','Insurance PC mapping proposal was not found').result);
  }

  async getWbsInsurancePcMappingTrace({tenantId,entityId,pcCode,accountingDate}){
    return this.inSession(async client=>requireRow(await client.query('SELECT refs_read_wbs_insurance_pc_mapping_trace($1,$2,$3,$4) AS result',[tenantId,entityId,pcCode,accountingDate]),'WBS_INSURANCE_PC_MAPPING_TRACE_FAILED','Insurance PC mapping trace was not returned').result);
  }

  async admitWbsSignedBankStatement({tenantId,entityId,admission,idempotencyKey}){
    const validated=validateWbsSignedBankAdmission(admission);
    if(typeof this.wbsSignedBankAdmissionVerifier!=='function')throw new KernelError('WBS_BANK_ADMISSION_SIGNATURE_REQUIRED','WBS bank admission requires a configured detached-signature verifier');
    let verified=false;
    try{verified=await this.wbsSignedBankAdmissionVerifier(admission);}
    catch{throw new KernelError('WBS_BANK_ADMISSION_SIGNATURE_INVALID','WBS bank admission signature verification failed');}
    if(verified!==true)throw new KernelError('WBS_BANK_ADMISSION_SIGNATURE_INVALID','WBS bank admission signature verification failed');
    return this.inSession(async client=>{
      const statement=validated.statement;
      const requestHash=requireRow(await client.query(
        'SELECT refs_wbs_signed_bank_admission_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',
        [tenantId,entityId,validated.snapshot_id,validated.package_hash,validated.admission_hash,validated.detached_signature.key_id,validated.detached_signature.algorithm,JSON.stringify(statement),JSON.stringify(validated.transactions)]
      ),'WBS_BANK_ADMISSION_HASH_FAILED','WBS bank admission hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_admit_wbs_signed_bank_statement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [tenantId,entityId,validated.snapshot_id,validated.package_hash,validated.admission_hash,validated.detached_signature.key_id,validated.detached_signature.algorithm,JSON.stringify(statement),JSON.stringify(validated.transactions),idempotencyKey,requestHash]
      ),'WBS_BANK_ADMISSION_FAILED','WBS bank admission did not return a result').result;
    });
  }

  // A verified provider transition contract is read-only external evidence.
  // It is deliberately not persisted or converted into a REFS command here:
  // any later cancellation/reopen workflow must still meet REFS CAS, SoD,
  // period, audit, and posted-ledger controls independently.
  async verifyWbsAutoRecTransitionContract({tenantId,entityId,contract}){
    const validated=validateWbsAutoRecTransitionContract(contract);
    if(typeof this.wbsAutoRecTransitionContractVerifier!=='function')throw new KernelError('WBS_AUTOREC_TRANSITION_CONTRACT_SIGNATURE_REQUIRED','WBS AutoRec transition evidence requires a configured detached-signature verifier');
    await this.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'WBS.AUTOREC.VIEW')",[tenantId,entityId]));
    let verified;
    try{verified=await this.wbsAutoRecTransitionContractVerifier(contract);}catch{throw new KernelError('WBS_AUTOREC_TRANSITION_CONTRACT_SIGNATURE_INVALID','WBS AutoRec transition contract signature verification failed');}
    if(!verified||verified.signature_verified!==true||verified.contract_hash!==validated.contract_hash)throw new KernelError('WBS_AUTOREC_TRANSITION_CONTRACT_SIGNATURE_INVALID','WBS AutoRec transition contract signature verification failed');
    return Object.freeze({...validated,signature_verified:true});
  }

  async assertWbsAutoRecView({tenantId,entityId}){
    await this.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'WBS.AUTOREC.VIEW')",[tenantId,entityId]));
    return true;
  }

  async assertWbsTestImport({tenantId,entityId}){
    await this.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'WBS.TEST.IMPORT')",[tenantId,entityId]));
    return true;
  }

  async assertWbsOperatorPayableAttest({tenantId,entityId}){
    await this.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'WBS.PAYABLE.OPERATOR_ATTEST')",[tenantId,entityId]));
    return true;
  }

  async attestWbsOperatorPayables({tenantId,entityId,capturedAt,providerContentHash,observationHash,companyCodes,rows,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_wbs_operator_payable_attest_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [tenantId,entityId,capturedAt,providerContentHash,observationHash,JSON.stringify(companyCodes),JSON.stringify(rows),reason]
      ),'WBS_OPERATOR_ATTEST_HASH_FAILED','WBS operator attestation hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_attest_wbs_operator_payables($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [tenantId,entityId,capturedAt,providerContentHash,observationHash,JSON.stringify(companyCodes),JSON.stringify(rows),reason,idempotencyKey,requestHash]
      ),'WBS_OPERATOR_ATTEST_FAILED','WBS operator attestation did not return a result').result;
    });
  }

  async listWbsOperatorPayableAttestations({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_wbs_operator_payable_attestations($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async linkWbsOperatorEvidenceToSignedSource({tenantId,entityId,wbsOperatorPayableEvidenceRowId,wbsInboundRowId,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_wbs_operator_signed_source_link_hash($1,$2,$3,$4) AS request_hash',
        [tenantId,entityId,wbsOperatorPayableEvidenceRowId,wbsInboundRowId]
      ),'WBS_OPERATOR_SIGNED_SOURCE_LINK_HASH_FAILED','WBS operator signed-source link hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_link_wbs_operator_evidence_to_signed_source($1,$2,$3,$4,$5,$6) AS result',
        [tenantId,entityId,wbsOperatorPayableEvidenceRowId,wbsInboundRowId,idempotencyKey,requestHash]
      ),'WBS_OPERATOR_SIGNED_SOURCE_LINK_FAILED','WBS operator signed-source link did not return a result').result;
    });
  }

  async listWbsOperatorPayableExceptionRows({tenantId,entityId,wbsOperatorPayableAttestationId,limit=10}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_wbs_operator_payable_exception_rows($1,$2,$3,$4)',
      [tenantId,entityId,wbsOperatorPayableAttestationId,limit]
    )).rows);
  }

  async readWbsProviderFinal1AdmissionScope({tenantId,entityId,dateFrom,dateTo}){
    return this.inSession(async client=>{
      await client.query("SELECT refs_assert_scope($1,$2,'WBS.SNAPSHOT.IMPORT')",[tenantId,entityId]);
      const entity=requireRow(await client.query(
        "SELECT entity_id,source_system,source_entity_id AS company_code,base_currency,active FROM entity WHERE tenant_id=$1 AND entity_id=$2",
        [tenantId,entityId]
      ),'WBS_FINAL1_ENTITY_SCOPE_NOT_FOUND','Final-1 entity scope is unavailable');
      const mappings=(await client.query(
        `SELECT mapping_hash,mapping_document,effective_from,effective_to
           FROM wbs_company_catalog_controller_decision
          WHERE tenant_id=$1 AND entity_id=$2 AND decision_type='APPROVED'
            AND active_status='ACTIVE' AND company_code=$3 AND base_currency=$4 AND effective_from<=$5::date
            AND (effective_to IS NULL OR effective_to>=$6::date)`,
        [tenantId,entityId,entity.company_code,entity.base_currency,dateFrom,dateTo]
      )).rows;
      if(mappings.length!==1)throw new KernelError('WBS_FINAL1_MAPPING_SCOPE_INVALID','Final-1 company mapping is missing or ambiguous for the complete delivery range');
      return {...entity,company_mapping_hash:mappings[0].mapping_hash,mapping_document:mappings[0].mapping_document,effective_from:mappings[0].effective_from,effective_to:mappings[0].effective_to};
    });
  }

  async retainWbsProviderFinal1SourceEvidence({tenantId,entityId,delivery,artifacts,plan,idempotencyKey}){
    return this.inSession(async client=>{
      if(['BANK','COST','PROPERTY'].includes(delivery?.domain)){
        const requestHash=requireRow(await client.query(
          'SELECT refs_wbs_final1_business_evidence_hash($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) AS request_hash',
          [tenantId,entityId,JSON.stringify(delivery),JSON.stringify(artifacts),JSON.stringify(plan)]
        ),'WBS_FINAL1_RETAINED_HASH_FAILED','Final-1 business evidence hash was not produced').request_hash;
        return requireRow(await client.query(
          'SELECT refs_retain_wbs_final1_business_evidence($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7) AS result',
          [tenantId,entityId,JSON.stringify(delivery),JSON.stringify(artifacts),JSON.stringify(plan),idempotencyKey,requestHash]
        ),'WBS_FINAL1_RETAINED_SOURCE_FAILED','Final-1 business evidence admission did not return a result').result;
      }
      const requestHash=requireRow(await client.query(
        'SELECT refs_wbs_final1_retained_evidence_hash($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) AS request_hash',
        [tenantId,entityId,JSON.stringify(delivery),JSON.stringify(artifacts),JSON.stringify(plan)]
      ),'WBS_FINAL1_RETAINED_HASH_FAILED','Final-1 retained evidence hash was not produced').request_hash;
      const result=requireRow(await client.query(
        'SELECT refs_retain_wbs_final1_source_evidence_with_signed_controls($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7) AS result',
        [tenantId,entityId,JSON.stringify(delivery),JSON.stringify(artifacts),JSON.stringify(plan),idempotencyKey,requestHash]
      ),'WBS_FINAL1_RETAINED_SOURCE_FAILED','Final-1 retained evidence admission did not return a result').result;
      return result;
    });
  }

  async listAiWbsExceptionFindings({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_wbs_exception_findings($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async listAiAmortizationSchedules({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_amortization_schedules($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async listAiAmortizationCoverageEvidence({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_amortization_coverage_evidence($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async recordAiAmortizationCoverageEvidence({tenantId,entityId,sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,evidenceRef,evidenceHash,extractionMethod,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ai_amortization_coverage_evidence_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',
        [tenantId,entityId,sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,evidenceRef,evidenceHash,extractionMethod]
      ),'AI_AMORTIZATION_COVERAGE_EVIDENCE_HASH_FAILED','AI amortization coverage evidence hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_record_ai_amortization_coverage_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [tenantId,entityId,sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,evidenceRef,evidenceHash,extractionMethod,idempotencyKey,requestHash]
      ),'AI_AMORTIZATION_COVERAGE_EVIDENCE_FAILED','AI amortization coverage evidence did not return a result').result;
    });
  }

  async proposeAiAmortizationSchedule({tenantId,entityId,sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,prepaidAccountCode,expenseAccountCode,memberTrace,confidence,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_propose_ai_amortization_schedule_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS request_hash',
        [tenantId,entityId,sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,prepaidAccountCode,expenseAccountCode,JSON.stringify(memberTrace),confidence,reason]
      ),'AI_AMORTIZATION_PROPOSAL_HASH_FAILED','AI amortization proposal hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_propose_ai_amortization_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',
        [tenantId,entityId,sourceDocumentId,sourcePayloadHash,coverageStart,coverageEnd,prepaidAccountCode,expenseAccountCode,JSON.stringify(memberTrace),confidence,reason,idempotencyKey,requestHash]
      ),'AI_AMORTIZATION_PROPOSAL_FAILED','AI amortization proposal did not return a result').result;
    });
  }

  async createAiAmortizationDraft({tenantId,entityId,aiAmortizationScheduleId,aiAmortizationScheduleLineId,periodId,expectedProposalHash,attachmentIds,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_ai_amortization_draft_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [tenantId,entityId,aiAmortizationScheduleId,aiAmortizationScheduleLineId,periodId,expectedProposalHash,attachmentIds,reason]
      ),'AI_AMORTIZATION_DRAFT_HASH_FAILED','AI amortization Draft hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_create_ai_amortization_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [tenantId,entityId,aiAmortizationScheduleId,aiAmortizationScheduleLineId,periodId,expectedProposalHash,attachmentIds,reason,idempotencyKey,requestHash]
      ),'AI_AMORTIZATION_DRAFT_FAILED','AI amortization Draft creation did not return a result').result;
    });
  }

  async listAiPrepaidCoverageFindings({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_prepaid_coverage_findings($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async listAiDuplicatePayableFindings({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_duplicate_payable_findings($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async listAiUnmatchedBankPaymentFindings({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_unmatched_bank_payment_findings($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async listAiCostDimensionFindings({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_cost_dimension_findings($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async listAiLoanReferenceFindings({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_loan_reference_findings($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  // These readers are deliberately evidence-only.  They are the only database
  // seam used by the AI accrual candidate analysis; none can write a finding,
  // source, Draft, review, approval, or journal.
  async readAiAccrualAnalysisPeriod({tenantId,entityId,currentPeriodId}){
    return this.inSession(async client=>{
      await client.query("SELECT refs_assert_scope($1,$2,'AI.ANALYSIS.EXPLAIN')",[tenantId,entityId]);
      return requireRow(await client.query(`SELECT p.period_id,p.period_code,(extract(year FROM p.starts_on)::integer*12+extract(month FROM p.starts_on)::integer) AS period_ordinal,e.source_entity_id AS company_code
        FROM accounting_period p JOIN entity e ON e.tenant_id=p.tenant_id AND e.entity_id=p.entity_id
        WHERE p.tenant_id=$1 AND p.entity_id=$2 AND p.period_id=$3 AND p.ledger_code='PRIMARY'`,[tenantId,entityId,currentPeriodId]),'AI_ACCRUAL_PERIOD_NOT_FOUND','Authoritative primary accounting period is unavailable');
    });
  }

  async listAiAccrualRetainedHistory({tenantId,entityId,currentPeriodId,limit=240}){
    return this.inSession(async client=>{
      await client.query("SELECT refs_assert_scope($1,$2,'AI.ANALYSIS.EXPLAIN')",[tenantId,entityId]);
      return (await client.query(`SELECT d.tenant_id,d.entity_id,d.source_entity_id,d.source_system,d.source_module,d.document_type,d.status AS source_status,d.source_document_id,l.source_document_line_id,p.period_id AS accounting_period_id,p.period_code,(extract(year FROM p.starts_on)::integer*12+extract(month FROM p.starts_on)::integer) AS period_ordinal,true AS period_closed,d.payload_hash,d.currency,l.amount::text,l.party_ref,l.external_dimension_refs
        FROM wbs_final1_retained_source_row r
        JOIN raw_event e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.raw_event_id=r.raw_event_id AND e.is_current
        JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id
        JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_line_id=r.source_document_line_id
        JOIN accounting_period p ON p.tenant_id=r.tenant_id AND p.entity_id=r.entity_id AND p.period_id=r.accounting_period_id AND p.ledger_code='PRIMARY'
        JOIN accounting_period current_period ON current_period.tenant_id=r.tenant_id AND current_period.entity_id=r.entity_id AND current_period.period_id=$3 AND current_period.ledger_code='PRIMARY'
        WHERE r.tenant_id=$1 AND r.entity_id=$2 AND r.domain='PAYABLES' AND d.document_type='WBS_FINAL1_PAYABLE' AND d.status='PENDING_REVIEW' AND p.status='CLOSED' AND p.starts_on<current_period.starts_on
        ORDER BY p.starts_on DESC,d.source_document_id DESC LIMIT $4`,[tenantId,entityId,currentPeriodId,limit])).rows;
    });
  }

  async listAiAccrualCurrentSourceIds({tenantId,entityId,currentPeriodId,recurringObligationId}){
    return this.inSession(async client=>{
      await client.query("SELECT refs_assert_scope($1,$2,'AI.ANALYSIS.EXPLAIN')",[tenantId,entityId]);
      return (await client.query(`SELECT DISTINCT d.source_document_id
        FROM wbs_final1_retained_source_row r JOIN raw_event e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.raw_event_id=r.raw_event_id AND e.is_current
        JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id
        JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_line_id=r.source_document_line_id
        WHERE r.tenant_id=$1 AND r.entity_id=$2 AND r.domain='PAYABLES' AND r.accounting_period_id=$3
          AND COALESCE(NULLIF(l.external_dimension_refs->>'signed_recurring_obligation_id',''),CASE WHEN NULLIF(l.external_dimension_refs->>'signed_contract_id','') IS NOT NULL AND NULLIF(l.party_ref,'') IS NOT NULL AND NULLIF(l.external_dimension_refs->>'signed_charge_code','') IS NOT NULL THEN 'contract:'||(l.external_dimension_refs->>'signed_contract_id')||'|vendor:'||l.party_ref||'|charge:'||(l.external_dimension_refs->>'signed_charge_code') END)=$4`,[tenantId,entityId,currentPeriodId,recurringObligationId])).rows.map(row=>row.source_document_id);
    });
  }

  async listAiAccrualPostedSourceIds({tenantId,entityId,currentPeriodId,recurringObligationId}){
    return this.inSession(async client=>{
      await client.query("SELECT refs_assert_scope($1,$2,'AI.ANALYSIS.EXPLAIN')",[tenantId,entityId]);
      return (await client.query(`SELECT DISTINCT d.source_document_id
        FROM wbs_final1_retained_source_row r JOIN raw_event e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.raw_event_id=r.raw_event_id AND e.is_current
        JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id
        JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_line_id=r.source_document_line_id
        JOIN source_link sl ON sl.tenant_id=r.tenant_id AND sl.entity_id=r.entity_id AND sl.source_document_id=d.source_document_id
        JOIN journal_entry j ON j.tenant_id=r.tenant_id AND j.entity_id=r.entity_id AND j.journal_entry_id=sl.journal_entry_id AND j.status='POSTED'
        WHERE r.tenant_id=$1 AND r.entity_id=$2 AND r.domain='PAYABLES' AND r.accounting_period_id=$3
          AND COALESCE(NULLIF(l.external_dimension_refs->>'signed_recurring_obligation_id',''),CASE WHEN NULLIF(l.external_dimension_refs->>'signed_contract_id','') IS NOT NULL AND NULLIF(l.party_ref,'') IS NOT NULL AND NULLIF(l.external_dimension_refs->>'signed_charge_code','') IS NOT NULL THEN 'contract:'||(l.external_dimension_refs->>'signed_contract_id')||'|vendor:'||l.party_ref||'|charge:'||(l.external_dimension_refs->>'signed_charge_code') END)=$4`,[tenantId,entityId,currentPeriodId,recurringObligationId])).rows.map(row=>row.source_document_id);
    });
  }

  async assignAiFindingAction({tenantId,entityId,findingKind,findingId,findingHash,owner,dueDate,expectedRevision,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_assign_ai_finding_action_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',[tenantId,entityId,findingKind,findingId,findingHash,owner,dueDate,expectedRevision]),'AI_FINDING_ACTION_HASH_FAILED','AI finding assignment hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_assign_ai_finding_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',[tenantId,entityId,findingKind,findingId,findingHash,owner,dueDate,expectedRevision,idempotencyKey,requestHash]),'AI_FINDING_ACTION_FAILED','AI finding assignment did not return a result').result;
    });
  }

  async listAiFindingAssignmentCandidates({tenantId,entityId,limit=100}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_finding_assignment_candidates($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async listAiFindingActions({tenantId,entityId,limit=100}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_finding_actions($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async resolveAiFindingAction({tenantId,entityId,aiFindingActionId,findingHash,reason,expectedRevision,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_resolve_ai_finding_action_hash($1,$2,$3,$4,$5,$6) AS request_hash',[tenantId,entityId,aiFindingActionId,findingHash,reason,expectedRevision]),'AI_FINDING_ACTION_RESOLUTION_HASH_FAILED','AI finding resolution hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_resolve_ai_finding_action($1,$2,$3,$4,$5,$6,$7,$8) AS result',[tenantId,entityId,aiFindingActionId,findingHash,reason,expectedRevision,idempotencyKey,requestHash]),'AI_FINDING_ACTION_RESOLUTION_FAILED','AI finding resolution did not return a result').result;
    });
  }

  async readAiAccountingAnalysisSummary({tenantId,entityId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_accounting_analysis_summary($1,$2)',[tenantId,entityId]
    )).rows);
  }

  async listAiAccountingAnalysisReports({tenantId,entityId,limit=20}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_accounting_analysis_reports($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async beginAiAccountingAnalysisExplanation({tenantId,entityId,summary,evidence,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ai_accounting_analysis_evidence_hash($1,$2,$3::jsonb,$4::jsonb) AS request_hash',[tenantId,entityId,JSON.stringify(summary),JSON.stringify(evidence)]
      ),'AI_ANALYSIS_EXPLANATION_HASH_FAILED','AI analysis explanation request hash was not produced').request_hash;
      const result=requireRow(await client.query(
        'SELECT refs_begin_ai_accounting_analysis_explanation($1,$2,$3::jsonb,$4::jsonb,$5,$6) AS result',[tenantId,entityId,JSON.stringify(summary),JSON.stringify(evidence),idempotencyKey,requestHash]
      ),'AI_ANALYSIS_EXPLANATION_BEGIN_FAILED','AI analysis explanation receipt was not produced').result;
      return {requestHash,result};
    });
  }

  async completeAiAccountingAnalysisExplanation({tenantId,entityId,idempotencyKey,requestHash,output}){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_complete_ai_accounting_analysis_explanation($1,$2,$3,$4,$5::jsonb) AS result',[tenantId,entityId,idempotencyKey,requestHash,JSON.stringify(output)]
    ),'AI_ANALYSIS_EXPLANATION_COMPLETE_FAILED','AI analysis explanation completion was not produced').result);
  }

  async abandonAiAccountingAnalysisExplanation({tenantId,entityId,idempotencyKey,requestHash}){
    return this.inSession(async client=>client.query(
      'SELECT refs_abandon_ai_accounting_analysis_explanation($1,$2,$3,$4)',[tenantId,entityId,idempotencyKey,requestHash]
    ));
  }

  // The service may only create an evidence-bound proposal.  The returned
  // object deliberately has no Draft, approval, or posting authority.
  async proposeAiWbsPayableDraft({tenantId,entityId,reviewEvidenceId,modelId,promptVersion,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ai_wbs_payable_draft_proposal_hash($1,$2,$3,$4,$5) AS request_hash',
        [tenantId,entityId,reviewEvidenceId,modelId,promptVersion]
      ),'AI_WBS_PAYABLE_PROPOSAL_HASH_FAILED','AI WBS payable proposal hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_propose_ai_wbs_payable_draft($1,$2,$3,$4,$5,$6,$7) AS result',
        [tenantId,entityId,reviewEvidenceId,modelId,promptVersion,idempotencyKey,requestHash]
      ),'AI_WBS_PAYABLE_PROPOSAL_FAILED','AI WBS payable proposal did not return a result').result;
    });
  }

  async listAiWbsPayableDraftProposals({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_ai_wbs_payable_draft_proposals($1,$2,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  // A human AP maker records an immutable accept/reject decision.  Creating
  // the ordinary WBS AP Draft remains a separate, existing command.
  async reviewAiWbsPayableDraftProposal({tenantId,entityId,proposalId,decision,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_review_ai_wbs_payable_draft_proposal_hash($1,$2,$3,$4,$5) AS request_hash',
        [tenantId,entityId,proposalId,decision,reason]
      ),'AI_WBS_PAYABLE_PROPOSAL_REVIEW_HASH_FAILED','AI WBS payable proposal review hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_review_ai_wbs_payable_draft_proposal($1,$2,$3,$4,$5,$6,$7) AS result',
        [tenantId,entityId,proposalId,decision,reason,idempotencyKey,requestHash]
      ),'AI_WBS_PAYABLE_PROPOSAL_REVIEW_FAILED','AI WBS payable proposal review did not return a result').result;
    });
  }

  async persistWbsInboundRows({tenantId,entityId,importBatchId,receipt,rows,idempotencyKey,requestHash}){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_persist_wbs_inbound_rows($1,$2,$3,$4,$5,$6,$7,$8) AS result',
      [tenantId,entityId,importBatchId,receipt.payload_hash,receipt.payload_ref,JSON.stringify(rows),idempotencyKey,requestHash]
    ),'WBS_INBOUND_PERSIST_FAILED','WBS inbound persistence did not return a result').result);
  }

  async admitWbsProviderSignedPayables({tenantId,entityId,delivery,snapshot,groups,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_wbs_provider_signed_payable_admission_hash($1,$2,$3,$4,$5) AS request_hash',
        [tenantId,entityId,JSON.stringify(delivery),JSON.stringify(snapshot),JSON.stringify(groups)]
      ),'WBS_PROVIDER_SIGNED_ADMISSION_HASH_FAILED','Provider signed Payable admission hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_admit_wbs_provider_signed_payables($1,$2,$3,$4,$5,$6,$7) AS result',
        [tenantId,entityId,JSON.stringify(delivery),JSON.stringify(snapshot),JSON.stringify(groups),idempotencyKey,requestHash]
      ),'WBS_PROVIDER_SIGNED_ADMISSION_FAILED','Provider signed Payable admission did not return a result').result;
    });
  }

  // Materializes only immutable Raw/Source/Pending Review evidence. The
  // Property Rent AR producer is intentionally absent, so this capability can
  // never create an Invoice, Journal, approval, posting batch, or ledger line.
  async admitWbsPropertyRentSource({tenantId,entityId,wbsInboundRowId,expectedSourceVersion,expectedReceiptHash,expectedEvidenceHash,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_admit_wbs_property_rent_source_hash($1,$2,$3,$4,$5,$6,$7) AS request_hash',
        [tenantId,entityId,wbsInboundRowId,expectedSourceVersion,expectedReceiptHash,expectedEvidenceHash,reason]
      ),'WBS_PROPERTY_RENT_SOURCE_HASH_FAILED','WBS Property Rent source admission hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_admit_wbs_property_rent_source($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
        [tenantId,entityId,wbsInboundRowId,expectedSourceVersion,expectedReceiptHash,expectedEvidenceHash,reason,idempotencyKey,requestHash]
      ),'WBS_PROPERTY_RENT_SOURCE_FAILED','WBS Property Rent source admission did not return a result').result;
    });
  }

  async reviewWbsPropertyRent({tenantId,entityId,admissionId,periodId,expectedRevision,expectedEvidenceHash,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_review_wbs_property_rent_hash($1,$2,$3,$4,$5,$6,$7) AS request_hash',[tenantId,entityId,admissionId,periodId,expectedRevision,expectedEvidenceHash,reason]),'WBS_PROPERTY_RENT_REVIEW_HASH_FAILED','Property Rent review hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_review_wbs_property_rent($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[tenantId,entityId,admissionId,periodId,expectedRevision,expectedEvidenceHash,reason,idempotencyKey,requestHash]),'WBS_PROPERTY_RENT_REVIEW_FAILED','Property Rent review did not return a result').result;
    });
  }

  async listWbsPropertyRentPickup({tenantId,entityId,periodId,limit=50}){
    return this.inSession(async client=>(await client.query('SELECT * FROM refs_list_wbs_property_rent_pickup($1,$2,$3,$4)',[tenantId,entityId,periodId,limit])).rows);
  }

  async createWbsPropertyRentDraft({tenantId,entityId,reviewEvidenceId,expectedRevision,expectedEvidenceHash,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_create_wbs_property_rent_draft_hash($1,$2,$3,$4,$5,$6) AS request_hash',[tenantId,entityId,reviewEvidenceId,expectedRevision,expectedEvidenceHash,reason]),'WBS_PROPERTY_RENT_DRAFT_HASH_FAILED','Property Rent Draft hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_create_wbs_property_rent_draft($1,$2,$3,$4,$5,$6,$7,$8) AS result',[tenantId,entityId,reviewEvidenceId,expectedRevision,expectedEvidenceHash,reason,idempotencyKey,requestHash]),'WBS_PROPERTY_RENT_DRAFT_FAILED','Property Rent Draft did not return a result').result;
    });
  }

  async listInsurancePrepaidAmortization({tenantId,entityId,periodId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT refs_read_insurance_prepaid_amortization($1,$2,$3,$4) AS evidence',[tenantId,entityId,periodId,limit]
    )).rows.map(row=>row.evidence));
  }

  async reviewInsurancePrepaidAmortization(args){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_review_insurance_prepaid_amortization_http($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS result',
      [args.tenantId,args.entityId,args.admissionId,args.scheduleId,args.scheduleLineId,args.periodId,args.settingSnapshotId,args.mappingSnapshotId,args.capitalizationJournalEntryId,args.capitalizationLedgerLineId,args.expectedSourceVersion,args.expectedSourceHash,args.expectedProposalHash,args.expectedCoverageHash,args.reason,args.idempotencyKey]
    ),'INSURANCE_AMORTIZATION_REVIEW_FAILED','Insurance prepaid amortization review did not return a result').result);
  }

  async createInsurancePrepaidAmortizationDraft(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_insurance_prepaid_amortization_draft_hash($1,$2,$3,$4,$5) AS request_hash',
        [args.tenantId,args.entityId,args.reviewEvidenceId,args.expectedEvidenceHash,args.reason]
      ),'INSURANCE_AMORTIZATION_DRAFT_HASH_FAILED','Insurance prepaid amortization Draft hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_create_insurance_prepaid_amortization_draft($1,$2,$3,$4,$5,$6,$7) AS result',
        [args.tenantId,args.entityId,args.reviewEvidenceId,args.expectedEvidenceHash,args.reason,args.idempotencyKey,requestHash]
      ),'INSURANCE_AMORTIZATION_DRAFT_FAILED','Insurance prepaid amortization Draft did not return a result').result;
    });
  }

  async reviewWbsPayable({tenantId,entityId,wbsInboundRowId,periodId,expectedRevision,expectedSourceVersion,expectedReceiptHash,expectedEvidenceHash,settingSnapshotId,mappingSnapshotId,attachmentIds,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_review_wbs_payable_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS request_hash',
        [tenantId,entityId,wbsInboundRowId,periodId,expectedRevision,expectedSourceVersion,expectedReceiptHash,expectedEvidenceHash,settingSnapshotId,mappingSnapshotId,attachmentIds,reason]
      ),'WBS_PAYABLE_REVIEW_HASH_FAILED','WBS payable review hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_review_wbs_payable($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS result',
        [tenantId,entityId,wbsInboundRowId,periodId,expectedRevision,expectedSourceVersion,expectedReceiptHash,expectedEvidenceHash,settingSnapshotId,mappingSnapshotId,attachmentIds,reason,idempotencyKey,requestHash]
      ),'WBS_PAYABLE_REVIEW_FAILED','WBS payable review did not return a result').result;
    });
  }

  // Cost-to-CWIP remains a controlled staging decision: this creates no journal
  // and leaves standard Draft/approval/Post controls as separate commands.
  async reviewWbsCostCwip({tenantId,entityId,wbsInboundRowId,periodId,expectedSourceVersion,expectedReceiptHash,expectedEvidenceHash,settingSnapshotId,mappingSnapshotId,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_review_wbs_cost_cwip_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',
        [tenantId,entityId,wbsInboundRowId,periodId,expectedSourceVersion,expectedReceiptHash,expectedEvidenceHash,settingSnapshotId,mappingSnapshotId,reason]
      ),'WBS_COST_CWIP_REVIEW_HASH_FAILED','WBS Cost-to-CWIP review hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_review_wbs_cost_cwip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
        [tenantId,entityId,wbsInboundRowId,periodId,expectedSourceVersion,expectedReceiptHash,expectedEvidenceHash,settingSnapshotId,mappingSnapshotId,reason,idempotencyKey,requestHash]
      ),'WBS_COST_CWIP_REVIEW_FAILED','WBS Cost-to-CWIP review did not return a result').result;
    });
  }

  async createWbsCostCwipDraft({tenantId,entityId,reviewEvidenceId,expectedEvidenceHash,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_wbs_cost_cwip_draft_hash($1,$2,$3,$4,$5) AS request_hash',
        [tenantId,entityId,reviewEvidenceId,expectedEvidenceHash,reason]
      ),'WBS_COST_CWIP_DRAFT_HASH_FAILED','WBS Cost-to-CWIP Draft hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_create_wbs_cost_cwip_draft($1,$2,$3,$4,$5,$6,$7) AS result',
        [tenantId,entityId,reviewEvidenceId,expectedEvidenceHash,reason,idempotencyKey,requestHash]
      ),'WBS_COST_CWIP_DRAFT_FAILED','WBS Cost-to-CWIP Draft creation did not return a result').result;
    });
  }

  async listWbsPayableReviewCandidates({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_wbs_payable_review_candidates($1,$2,NULL,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async getWbsPayableReviewCandidate({tenantId,entityId,wbsInboundRowId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_wbs_payable_review_candidates($1,$2,$3,1)',[tenantId,entityId,wbsInboundRowId]
    )).rows);
  }

  async bindWbsPayableAttachment({tenantId,entityId,wbsInboundRowId,attachmentId,expectedRevision,expectedSourceVersion,expectedReceiptHash,expectedProviderReceiptHash,expectedEvidenceHash,expectedAttachmentContentHash,expectedAttachmentStorageVersion,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_bind_wbs_payable_attachment_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS request_hash',
        [tenantId,entityId,wbsInboundRowId,attachmentId,expectedRevision,expectedSourceVersion,expectedReceiptHash,expectedProviderReceiptHash,expectedEvidenceHash,expectedAttachmentContentHash,expectedAttachmentStorageVersion,reason]
      ),'WBS_PAYABLE_ATTACHMENT_BIND_HASH_FAILED','WBS Payable attachment binding hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_bind_wbs_payable_attachment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS result',
        [tenantId,entityId,wbsInboundRowId,attachmentId,expectedRevision,expectedSourceVersion,expectedReceiptHash,expectedProviderReceiptHash,expectedEvidenceHash,expectedAttachmentContentHash,expectedAttachmentStorageVersion,reason,idempotencyKey,requestHash]
      ),'WBS_PAYABLE_ATTACHMENT_BIND_FAILED','WBS Payable attachment binding did not return a result').result;
    });
  }

  async listWbsPayableAttachmentUploads({tenantId,entityId,wbsInboundRowId}){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_payable_attachment_uploads($1,$2,$3) AS result',[tenantId,entityId,wbsInboundRowId]
    ),'WBS_PAYABLE_ATTACHMENT_UPLOAD_READ_FAILED','Row-bound attachment status did not return a result').result);
  }

  async bindWbsPayableUploadedAttachment({tenantId,entityId,wbsInboundRowId,attachmentId,expectedRevision,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_bind_wbs_payable_uploaded_attachment_hash($1,$2,$3,$4,$5,$6) AS request_hash',
        [tenantId,entityId,wbsInboundRowId,attachmentId,expectedRevision,reason]
      ),'WBS_PAYABLE_ATTACHMENT_BIND_HASH_FAILED','Safe row-bound attachment binding hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_bind_wbs_payable_uploaded_attachment($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [tenantId,entityId,wbsInboundRowId,attachmentId,expectedRevision,reason,idempotencyKey,requestHash]
      ),'WBS_PAYABLE_ATTACHMENT_BIND_FAILED','Safe row-bound WBS Payable attachment binding did not return a result').result;
    });
  }

  async createWbsPayableApDraft({tenantId,entityId,wbsInboundRowId,reviewEvidenceId,expectedRevision,expectedEvidenceHash,mappingSnapshotId,attachmentIds,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_wbs_payable_ap_draft_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',
        [tenantId,entityId,wbsInboundRowId,reviewEvidenceId,expectedRevision,expectedEvidenceHash,mappingSnapshotId,attachmentIds,reason]
      ),'WBS_PAYABLE_AP_DRAFT_HASH_FAILED','WBS Payable AP Draft hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_create_wbs_payable_ap_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [tenantId,entityId,wbsInboundRowId,reviewEvidenceId,expectedRevision,expectedEvidenceHash,mappingSnapshotId,attachmentIds,reason,idempotencyKey,requestHash]
      ),'WBS_PAYABLE_AP_DRAFT_FAILED','WBS Payable AP Draft creation did not return a result').result;
    });
  }

  async listWbsPayableReviewEvidence({tenantId,entityId,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_wbs_payable_review_evidence($1,$2,NULL,$3)',[tenantId,entityId,limit]
    )).rows);
  }

  async getWbsPayableReviewEvidence({tenantId,entityId,reviewEvidenceId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_read_wbs_payable_review_evidence($1,$2,$3,1)',[tenantId,entityId,reviewEvidenceId]
    )).rows);
  }

  // The database function is REFS-owned and verifies receipt-backed WBS
  // sources under locks. It never invokes WBS and never creates or posts JE.
  async executeWbsAutoRecIntent({tenantId,entityId,intent}){
    if(!intent||typeof intent!=='object'||typeof intent.idempotency_key!=='string'||typeof intent.request_hash!=='string')throw new KernelError('WBS_AUTOREC_EXECUTION_INPUT_INVALID','A canonical WBS AutoRec execution intent is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_execute_wbs_autorec_intent($1,$2,$3,$4,$5) AS result',
      [tenantId,entityId,JSON.stringify(intent),intent.idempotency_key,intent.request_hash]
    ),'WBS_AUTOREC_EXECUTION_FAILED','WBS AutoRec execution did not return a result').result);
  }

  async persistWbsInboundSnapshotRows({tenantId,entityId,importBatchId,groups,idempotencyKey,requestHash}){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_persist_wbs_inbound_snapshot_rows($1,$2,$3,$4,$5,$6) AS result',
      [tenantId,entityId,importBatchId,JSON.stringify(groups),idempotencyKey,requestHash]
    ),'WBS_INBOUND_SNAPSHOT_PERSIST_FAILED','WBS inbound snapshot persistence did not return a result').result);
  }

  async persistWbsTraceRelationEvidence({tenantId,entityId,source,traceReceipt,relations,idempotencyKey,bindingHash}){
    const requestHash=canonicalRequestHash({source,receipt:traceReceipt,relations});
    if(bindingHash!==undefined&&bindingHash!==requestHash)throw new KernelError('WBS_TRACE_RELATION_HASH_INVALID','WBS trace relation binding hash must match the canonical source, receipt, and relation evidence');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_persist_wbs_trace_relation_evidence($1,$2,$3,$4,$5,$6,$7) AS result',
      [tenantId,entityId,JSON.stringify(source),JSON.stringify(traceReceipt),JSON.stringify(relations),idempotencyKey,requestHash]
    ),'WBS_TRACE_RELATION_PERSIST_FAILED','WBS trace relation persistence did not return a result').result);
  }

  async readWbsTraceRelationEvidence({tenantId,entityId,source,read_only}){
    if(read_only!==true||!source||typeof source!=='object')throw new KernelError('WBS_TRACE_RELATION_READ_SCOPE_INVALID','An explicit read-only WBS trace source selection is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_trace_relation_evidence($1,$2,$3) AS result',[tenantId,entityId,JSON.stringify(source)]
    ),'WBS_TRACE_RELATION_READ_FAILED','WBS trace relation read did not return a result').result);
  }

  async persistWbsControlMetricSnapshot({tenantId,entityId,sourceType,scope,receiptId,receipt,metrics,idempotencyKey,bindingHash}){
    const requestHash=canonicalRequestHash({sourceType,scope,receiptId,receipt,metrics});
    if(bindingHash!==undefined&&bindingHash!==requestHash)throw new KernelError('WBS_CONTROL_SNAPSHOT_HASH_INVALID','WBS control snapshot binding hash must match the canonical source, scope, receipt, and metrics');
    if(!receipt||receipt.metrics_hash!==canonicalRequestHash(metrics))throw new KernelError('WBS_CONTROL_SNAPSHOT_METRICS_HASH_INVALID','WBS control snapshot metrics must match the receipt metrics hash');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_persist_wbs_control_metric_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
      [tenantId,entityId,sourceType,JSON.stringify(scope),receiptId,JSON.stringify(receipt),JSON.stringify(metrics),idempotencyKey,requestHash]
    ),'WBS_CONTROL_SNAPSHOT_PERSIST_FAILED','WBS control metric snapshot persistence did not return a result').result);
  }

  async readPersistedWbsControlSnapshot({source_type,tenant_id,entity_id,scope,read_only}){
    if(read_only!==true||!scope||typeof scope!=='object')throw new KernelError('WBS_CONTROL_READ_SCOPE_INVALID','An explicit read-only WBS control selection is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_control_metric_snapshot($1,$2,$3,$4) AS result',[tenant_id,entity_id,source_type,JSON.stringify(scope)]
    ),'WBS_CONTROL_READ_FAILED','WBS control snapshot read did not return a result').result);
  }

  async readPersistedRefsControlMetricSnapshot({source_type,tenant_id,entity_id,scope,read_only}){
    if(read_only!==true||!scope||typeof scope!=='object')throw new KernelError('WBS_CONTROL_READ_SCOPE_INVALID','An explicit read-only REFS control selection is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_refs_control_metric_snapshot($1,$2,$3,$4) AS result',[tenant_id,entity_id,source_type,JSON.stringify(scope)]
    ),'WBS_CONTROL_READ_FAILED','REFS control metric snapshot read did not return a result').result);
  }

  async readApprovedWbsControlReconciliationMapping({source_type,tenant_id,entity_id,scope,read_only}){
    if(read_only!==true||!scope||typeof scope!=='object')throw new KernelError('WBS_CONTROL_READ_SCOPE_INVALID','An explicit read-only WBS control mapping selection is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_control_reconciliation_mapping($1,$2,$3,$4) AS result',[tenant_id,entity_id,source_type,JSON.stringify(scope)]
    ),'WBS_CONTROL_READ_FAILED','WBS control reconciliation mapping read did not return a result').result);
  }

  async persistWbsAutoRecObservedStateEvidence({tenantId,entityId,observations,idempotencyKey,bindingHash}){
    const requestHash=canonicalRequestHash({tenantId,entityId,observations});
    if(bindingHash!==undefined&&bindingHash!==requestHash)throw new KernelError('WBS_AUTOREC_OBSERVED_STATE_HASH_INVALID','WBS observed-state evidence binding hash must match its scoped observations');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_persist_wbs_autorec_observed_state_evidence($1,$2,$3,$4,$5) AS result',
      [tenantId,entityId,JSON.stringify(observations),idempotencyKey,requestHash]
    ),'WBS_AUTOREC_OBSERVED_STATE_PERSIST_FAILED','WBS observed-state evidence persistence did not return a result').result);
  }

  async readWbsAutoRecObservedStateEvidence({tenantId,entityId,companyKey,sourceRecordIds,read_only}){
    if(read_only!==true||typeof companyKey!=='string'||companyKey.trim()===''||!Array.isArray(sourceRecordIds)||sourceRecordIds.length===0||sourceRecordIds.some(value=>typeof value!=='string'||value.trim()===''))throw new KernelError('WBS_AUTOREC_OBSERVED_STATE_READ_SCOPE_INVALID','A non-empty read-only observed-state selection is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_autorec_observed_state_evidence($1,$2,$3,$4::text[]) AS rows',[tenantId,entityId,companyKey,sourceRecordIds]
    ),'WBS_AUTOREC_OBSERVED_STATE_READ_FAILED','WBS observed-state evidence read did not return a result').rows);
  }

  async readPersistedWbsInboundRows({tenantId,entityId,companyKey,sourceRecordIds,read_only}){
    if(read_only!==true||typeof companyKey!=='string'||companyKey.trim()===''||!Array.isArray(sourceRecordIds)||sourceRecordIds.length===0||sourceRecordIds.some(value=>typeof value!=='string'||value.trim()===''))throw new KernelError('WBS_AUTOREC_READ_SCOPE_INVALID','A non-empty read-only WBS inbound selection is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_inbound_rows($1,$2,$3,$4::text[]) AS rows',[tenantId,entityId,companyKey,sourceRecordIds]
    ),'WBS_AUTOREC_READ_FAILED','WBS inbound read did not return a result').rows);
  }

  async readPersistedWbsControlRows({tenantId,entityId,companyKey,sourceRecordIds,read_only}){
    if(read_only!==true||typeof companyKey!=='string'||companyKey.trim()===''||!Array.isArray(sourceRecordIds)||sourceRecordIds.length===0||sourceRecordIds.some(value=>typeof value!=='string'||value.trim()===''))throw new KernelError('WBS_AUTOREC_READ_SCOPE_INVALID','A non-empty read-only WBS control selection is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_autorec_control_rows($1,$2,$3,$4::text[]) AS rows',[tenantId,entityId,companyKey,sourceRecordIds]
    ),'WBS_AUTOREC_READ_FAILED','WBS control read did not return a result').rows);
  }

  async readApprovedWbsAutoRecMappings({tenantId,entityId,companyKey,read_only}){
    if(read_only!==true||typeof companyKey!=='string'||companyKey.trim()==='')throw new KernelError('WBS_AUTOREC_READ_SCOPE_INVALID','An explicit scoped read-only WBS mapping selection is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_autorec_mappings($1,$2,$3) AS rows',[tenantId,entityId,companyKey]
    ),'WBS_AUTOREC_READ_FAILED','WBS approved mapping read did not return a result').rows);
  }

  async readApprovedWbsAutoRecMatchingPolicies({tenantId,entityId,companyKey,read_only}){
    if(read_only!==true||typeof companyKey!=='string'||companyKey.trim()==='')throw new KernelError('WBS_AUTOREC_READ_SCOPE_INVALID','An explicit scoped read-only WBS matching-policy selection is required');
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_read_wbs_autorec_matching_policies($1,$2,$3) AS rows',[tenantId,entityId,companyKey]
    ),'WBS_AUTOREC_READ_FAILED','WBS approved matching-policy read did not return a result').rows);
  }

  async createAutoJournal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_auto_journal_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [args.tenantId,args.entityId,args.stagingItemId,args.periodId,args.expectedStagingVersion,args.journalNumber,args.description??null,JSON.stringify(args.lines)]
      ),'AUTO_JOURNAL_CREATE_HASH_FAILED','Automatic journal hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_auto_journal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [args.tenantId,args.entityId,args.stagingItemId,args.periodId,args.expectedStagingVersion,args.journalNumber,args.description??null,JSON.stringify(args.lines),args.idempotencyKey,requestHash]
      ),'AUTO_JOURNAL_CREATE_FAILED','Automatic journal creation did not return a result');
      return row.result;
    });
  }

  async createJournalAdjustment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_journal_adjustment_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS request_hash',
        [args.action,args.tenantId,args.entityId,args.originalJournalEntryId,args.periodId,args.journalNumber,args.journalDate,args.description??null,args.reason,args.lines?JSON.stringify(args.lines):null,args.attachmentIds??[]]
      ),'JOURNAL_ADJUSTMENT_HASH_FAILED','Journal adjustment hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_journal_adjustment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',
        [args.action,args.tenantId,args.entityId,args.originalJournalEntryId,args.periodId,args.journalNumber,args.journalDate,args.description??null,args.reason,args.lines?JSON.stringify(args.lines):null,args.attachmentIds??[],args.idempotencyKey,requestHash]
      ),'JOURNAL_ADJUSTMENT_FAILED','Journal adjustment creation did not return a result');
      return row.result;
    });
  }

  async createApBillVoid(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ap_bill_void_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.expectedVersion,args.journalNumber,args.journalDate,args.reason]
      ),'AP_BILL_VOID_HASH_FAILED','AP bill void hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ap_bill_void($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.expectedVersion,args.journalNumber,args.journalDate,args.reason,args.idempotencyKey,requestHash]
      ),'AP_BILL_VOID_FAILED','AP bill void Draft creation did not return a result');
      return row.result;
    });
  }

  async createApVendorCredit(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ap_vendor_credit_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',
        [args.tenantId,args.entityId,args.periodId,args.creditNumber,args.creditDate,args.vendorRef,args.vendorName,args.amount,JSON.stringify(args.lines),args.reason]
      ),'AP_VENDOR_CREDIT_HASH_FAILED','AP vendor credit hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ap_vendor_credit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
        [args.tenantId,args.entityId,args.periodId,args.creditNumber,args.creditDate,args.vendorRef,args.vendorName,args.amount,JSON.stringify(args.lines),args.reason,args.idempotencyKey,requestHash]
      ),'AP_VENDOR_CREDIT_FAILED','AP vendor credit Draft creation did not return a result');
      return row.result;
    });
  }

  async applyApVendorCredit(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ap_vendor_credit_allocation_hash($1,$2,$3,$4,$5,$6) AS request_hash',
        [args.tenantId,args.entityId,args.businessAdjustmentId,args.businessDocumentId,args.amount,args.reason]
      ),'AP_VENDOR_CREDIT_ALLOCATION_HASH_FAILED','AP vendor credit allocation hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_apply_ap_vendor_credit($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [args.tenantId,args.entityId,args.businessAdjustmentId,args.businessDocumentId,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AP_VENDOR_CREDIT_ALLOCATION_FAILED','AP vendor credit allocation did not return a result');
      return row.result;
    });
  }

  async createApPayment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ap_payment_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.paymentNumber,args.paymentDate,args.cashAccountCode,args.bankMemberRef??null,args.amount,args.reason]
      ),'AP_PAYMENT_HASH_FAILED','AP payment hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ap_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.paymentNumber,args.paymentDate,args.cashAccountCode,args.bankMemberRef??null,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AP_PAYMENT_FAILED','AP payment Draft creation did not return a result');
      return row.result;
    });
  }

  async createArReceipt(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ar_receipt_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.receiptNumber,args.receiptDate,args.cashAccountCode,args.bankMemberRef??null,args.amount,args.reason]
      ),'AR_RECEIPT_HASH_FAILED','AR receipt hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ar_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.receiptNumber,args.receiptDate,args.cashAccountCode,args.bankMemberRef??null,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AR_RECEIPT_FAILED','AR receipt Draft creation did not return a result');
      return row.result;
    });
  }

  async createArReceiptReversal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_ar_receipt_reversal_hash($1,$2,$3,$4,$5,$6,$7) AS request_hash',[args.tenantId,args.entityId,args.sourceOccurrenceId,args.periodId,args.journalNumber,args.journalDate,args.reason]),'AR_RECEIPT_REVERSAL_HASH_FAILED','AR receipt reversal hash was not produced').request_hash;
      const row=requireRow(await client.query('SELECT refs_create_ar_receipt_reversal($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[args.tenantId,args.entityId,args.sourceOccurrenceId,args.periodId,args.journalNumber,args.journalDate,args.reason,args.idempotencyKey,requestHash]),'AR_RECEIPT_REVERSAL_FAILED','AR receipt reversal Draft creation did not return a result');
      return row.result;
    });
  }

  async getArAging({tenantId,entityId,asOfDate}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_ar_aging($1,$2,$3::date)',[tenantId,entityId,asOfDate]
    )).rows);
  }

  async listBusinessDocuments({tenantId,entityId,documentKind}){
    if(!['AP_BILL','AR_INVOICE'].includes(documentKind))throw new KernelError('BUSINESS_DOCUMENT_KIND_INVALID','Unsupported business document kind');
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_business_documents($1,$2,$3)',[tenantId,entityId,documentKind]
    )).rows.map(row=>({...row,accounting_date:publicDate(row.accounting_date),due_date:row.due_date==null?null:publicDate(row.due_date)})));
  }

  async listBusinessAdjustments({tenantId,entityId,module}){
    if(!['AP','AR'].includes(module))throw new KernelError('BUSINESS_ADJUSTMENT_MODULE_INVALID','Unsupported business adjustment module');
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_business_adjustments($1,$2,$3)',[tenantId,entityId,module]
    )).rows.map(row=>({...row,accounting_date:publicDate(row.accounting_date)})));
  }

  async listJournalEntries({tenantId,entityId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_journal_entries($1,$2)',[tenantId,entityId]
    )).rows.map(row=>({...row,journal_date:publicDate(row.journal_date)})));
  }

  async getJournalWorkflowCapabilities({tenantId,entityId}){
    return this.inSession(async client=>{
      await client.query("SELECT refs_assert_scope($1,$2,'GL.JE.VIEW')",[tenantId,entityId]);
      return requireRow(await client.query(`SELECT
        $1::uuid AS entity_id,
        refs_entity_has_permission($1,'GL.JE.SUBMIT') AS can_submit,
        refs_entity_has_permission($1,'GL.JE.REVIEW') AS can_review,
        refs_entity_has_permission($1,'GL.JE.APPROVE') AS can_approve,
        refs_entity_has_permission($1,'GL.JE.POST') AS can_post`,[entityId]),
      'JOURNAL_WORKFLOW_CAPABILITIES_MISSING','Journal workflow capabilities were not returned');
    });
  }

  async getJournalEntryDetail({tenantId,entityId,periodId,journalEntryId}){
    return this.inSession(async client=>{
      const rows=(await client.query(
        'SELECT * FROM refs_get_journal_entry_detail($1,$2,$3,$4)',
        [tenantId,entityId,periodId,journalEntryId]
      )).rows;
      if(!rows.length)throw new KernelError('P0002','Journal entry was not found');
      const header=rows[0];
      const revision=Number(header.revision);
      if(!Number.isSafeInteger(revision)||revision<0)throw new KernelError('JOURNAL_ENTRY_DETAIL_INVALID','Journal Entry detail revision is outside the public read contract');
      const journalDate=header.journal_date instanceof Date
        ? `${header.journal_date.getFullYear()}-${String(header.journal_date.getMonth()+1).padStart(2,'0')}-${String(header.journal_date.getDate()).padStart(2,'0')}`
        : String(header.journal_date);
      return {
        entity_id:header.entity_id,period_id:header.period_id,journal_entry_id:header.journal_entry_id,
        journal_number:header.journal_number,journal_type:header.journal_type,status:header.status,
        journal_date:journalDate,currency:header.currency,description:header.journal_description??null,
        revision,created_at:header.created_at,posted_at:header.posted_at??null,
        lines:rows.map(row=>({
          line_no:row.line_no,journal_line_id:row.journal_line_id,ledger_line_id:row.ledger_line_id??null,
          account_code:row.account_code,debit_amount:row.debit_amount,credit_amount:row.credit_amount,
          member_ref:row.member_ref??null,description:row.line_description??null,dimensions:row.dimensions,
          source_document_ids:row.source_document_ids,
        })),
      };
    });
  }

  async listChartOfAccounts({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_chart_of_accounts($1,$2,$3)',[tenantId,entityId,periodId]
    )).rows);
  }

  async readAuthoritativeScope({tenantId,entityId,periodId}){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT * FROM refs_read_authoritative_scope($1,$2,$3)',[tenantId,entityId,periodId]
    ),'AUTHORITATIVE_SCOPE_NOT_FOUND','Authoritative entity and period scope is unavailable'));
  }

  async readCurrentActorAccess({tenantId,entityId}){
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT * FROM refs_read_current_actor_access($1,$2)',[tenantId,entityId]
      ),'CURRENT_ACTOR_ACCESS_UNAVAILABLE','Current actor access is unavailable');
      const version=Number(row.grant_set_version);
      if(!Number.isSafeInteger(version)||version<0
        ||!Array.isArray(row.permissions)||row.permissions.some(permission=>typeof permission!=='string')
        ||!Array.isArray(row.configured_permissions)||row.configured_permissions.some(permission=>typeof permission!=='string')
        ||typeof row.session_refresh_required!=='boolean'){
        throw new KernelError('CURRENT_ACTOR_ACCESS_INVALID','Current actor access is outside the public read contract');
      }
      return {...row,grant_set_version:version,permissions:[...row.permissions],configured_permissions:[...row.configured_permissions]};
    });
  }

  async listAccountRegister({tenantId,entityId,periodId,accountCode}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_account_register($1,$2,$3,$4)',[tenantId,entityId,periodId,accountCode]
    )).rows.map(row=>({...row,...(row.period_start===undefined?{}:{period_start:publicDate(row.period_start)}),...(row.period_end===undefined?{}:{period_end:publicDate(row.period_end)}),...(row.journal_date===undefined?{}:{journal_date:publicDate(row.journal_date)})})));
  }

  async listGeneralLedger({tenantId,entityId,periodId,accountCode=null,query=null,limit=50,offset=0}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_general_ledger($1,$2,$3,$4,$5,$6,$7)',[tenantId,entityId,periodId,accountCode,query,limit,offset]
    )).rows.map(row=>({...row,...(row.period_start===undefined?{}:{period_start:publicDate(row.period_start)}),...(row.period_end===undefined?{}:{period_end:publicDate(row.period_end)}),...(row.journal_date===undefined?{}:{journal_date:publicDate(row.journal_date)})})));
  }

  async listSourceDocuments({tenantId,entityId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_source_documents($1,$2)',[tenantId,entityId]
    )).rows.map(row=>({...row,...(row.business_date===undefined?{}:{business_date:publicDate(row.business_date)}),...(row.accounting_date===undefined?{}:{accounting_date:publicDate(row.accounting_date)}),...(row.source_line_count===undefined?{}:{source_line_count:Number(row.source_line_count)})})));
  }

  async getSourceDocumentDetail({tenantId,entityId,sourceDocumentId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_source_document_detail($1,$2,$3)',[tenantId,entityId,sourceDocumentId]
    )).rows.map(row=>({...row,...(row.business_date===undefined?{}:{business_date:publicDate(row.business_date)}),...(row.accounting_date===undefined?{}:{accounting_date:publicDate(row.accounting_date)}),...(row.source_line_count===undefined?{}:{source_line_count:Number(row.source_line_count)}),lines:Array.isArray(row.lines)?row.lines.map(line=>{
      if(line?.provider_trace!==null)return line;
      const {provider_trace,...withoutAbsentTrace}=line;
      return withoutAbsentTrace;
    }):row.lines})));
  }

  async getWbsProviderSignedSourceEvidence({tenantId,entityId,sourceDocumentId}){
    return this.inSession(async client=>{
      await client.query('SELECT refs_assert_scope($1,$2,$3)',[tenantId,entityId,'GL.JE.VIEW']);
      const row=requireRow(await client.query(`
        WITH retained AS (
          SELECT tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain,
                 accounting_period_id,source_document_id,raw_event_id,source_record_id,
                 source_version,raw_row_hash
            FROM wbs_final1_retained_source_row
          UNION ALL
          SELECT tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain,
                 accounting_period_id,source_document_id,raw_event_id,source_record_id,
                 source_version,raw_row_hash
            FROM wbs_final1_signed_business_source_row
        )
        SELECT d.tenant_id,d.entity_id,r.accounting_period_id,d.source_document_id,
               r.raw_event_id,r.source_record_id,r.source_version,r.raw_row_hash AS source_row_hash,
               a.wbs_final1_retained_evidence_admission_id AS admission_id,
               a.request_hash AS admission_hash,a.snapshot_id,a.issuer,a.key_id,a.algorithm,
               a.receipt_hash,a.receipt_storage_version,a.request_raw_hash,a.request_storage_version,
               a.response_raw_hash,a.response_storage_version,a.package_raw_hash,a.package_hash,
               a.package_storage_version,c.control_totals,c.control_totals_hash
          FROM source_document d
          JOIN retained r ON r.tenant_id=d.tenant_id AND r.entity_id=d.entity_id
                         AND r.source_document_id=d.source_document_id AND r.raw_event_id=d.raw_event_id
                         AND r.source_record_id=d.source_record_id AND r.source_version=d.source_version
                         AND r.raw_row_hash=d.payload_hash
          JOIN wbs_final1_retained_evidence_admission a
            ON a.tenant_id=r.tenant_id AND a.entity_id=r.entity_id
           AND a.wbs_final1_retained_evidence_admission_id=r.wbs_final1_retained_evidence_admission_id
           AND a.domain=r.domain
          JOIN wbs_final1_signed_control_total c
            ON c.tenant_id=a.tenant_id AND c.entity_id=a.entity_id
           AND c.wbs_final1_retained_evidence_admission_id=a.wbs_final1_retained_evidence_admission_id
           AND c.domain=a.domain
         WHERE d.tenant_id=$1 AND d.entity_id=$2 AND d.source_document_id=$3
           AND d.source_system='WBS' AND r.accounting_period_id IS NOT NULL
      `,[tenantId,entityId,sourceDocumentId]),'WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_NOT_AVAILABLE','Exact formally admitted provider-signed source evidence is not available');
      return Object.freeze({
        evidence_version:'WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_V1',provider_mode:'SIGNED_OBJECT_LOCK',
        admission_status:'ADMITTED',signature_verified:true,tenant_id:row.tenant_id,entity_id:row.entity_id,
        accounting_period_id:row.accounting_period_id,source_document_id:row.source_document_id,
        raw_event_id:row.raw_event_id,source_record_id:row.source_record_id,source_version:row.source_version,
        source_row_hash:row.source_row_hash,admission_id:row.admission_id,admission_hash:row.admission_hash,
        snapshot_id:row.snapshot_id,issuer:row.issuer,key_id:row.key_id,algorithm:row.algorithm,
        control_totals:row.control_totals,control_totals_hash:row.control_totals_hash,
        action_flags:Object.freeze({can_propose_amortization:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false}),
        artifacts:Object.freeze({
          receipt:Object.freeze({sha256:row.receipt_hash,version_id:row.receipt_storage_version}),
          request:Object.freeze({sha256:row.request_raw_hash,version_id:row.request_storage_version}),
          response:Object.freeze({sha256:row.response_raw_hash,version_id:row.response_storage_version}),
          package:Object.freeze({sha256:row.package_raw_hash,canonical_package_hash:row.package_hash,version_id:row.package_storage_version}),
        }),
      });
    });
  }

  async listBankTransactions({tenantId,entityId,bankAccountRef,fromDate=null,throughDate=null,limit=100,offset=0}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_bank_transactions($1,$2,$3,$4::date,$5::date,$6,$7)',
      [tenantId,entityId,bankAccountRef,fromDate,throughDate,limit,offset]
    )).rows.map(row=>({...row,transaction_date:publicDate(row.transaction_date)})));
  }

  async listBankMatchCandidates({tenantId,entityId,bankSourceId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_bank_match_candidates($1,$2,$3)',[tenantId,entityId,bankSourceId]
    )).rows.map(row=>({...row,accounting_date:publicDate(row.accounting_date)})));
  }

  async reviewWbsAutoRecBankMatch({tenantId,entityId,reviewCandidateId,candidateHash,bankMatchId,expectedMatchRevision,decision,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_wbs_autorec_match_review_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [tenantId,entityId,reviewCandidateId,candidateHash,bankMatchId,expectedMatchRevision,decision,reason]
      ),'WBS_AUTOREC_MATCH_REVIEW_HASH_FAILED','AutoRec Bank Match review request hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_review_wbs_autorec_bank_match($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [tenantId,entityId,reviewCandidateId,candidateHash,bankMatchId,expectedMatchRevision,decision,reason,idempotencyKey,requestHash]
      ),'WBS_AUTOREC_MATCH_REVIEW_FAILED','AutoRec Bank Match review did not return a result').result;
    });
  }

  async getWbsAutoRecBankMatchReview({tenantId,entityId,reviewId}){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_get_wbs_autorec_match_review($1,$2,$3) AS result',[tenantId,entityId,reviewId]
    ),'WBS_AUTOREC_MATCH_REVIEW_READ_FAILED','AutoRec Bank Match review read did not return a result').result);
  }

  async createWbsAutoRecPayableIncurDraft(args){return this.createWbsAutoRecEventDraft('refs_create_wbs_autorec_payable_incur_draft',args);}
  async createWbsAutoRecAutocDraft(args){return this.createWbsAutoRecEventDraft('refs_create_wbs_autorec_autoc_draft',args);}
  async createWbsAutoRecEventDraft(functionName,{tenantId,entityId,reviewId,periodId,expectedEvidenceHash,reason,idempotencyKey}){
    if(!['refs_create_wbs_autorec_payable_incur_draft','refs_create_wbs_autorec_autoc_draft'].includes(functionName))throw new KernelError('WBS_AUTOREC_EVENT_DRAFT_FUNCTION_DENIED','AutoRec event Draft producer is not allowlisted');
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_wbs_autorec_event_draft_hash($1,$2,$3,$4,$5,$6) request_hash',[tenantId,entityId,reviewId,periodId,expectedEvidenceHash,reason]),'WBS_AUTOREC_EVENT_DRAFT_HASH_FAILED','AutoRec event Draft hash was not produced').request_hash;
      return requireRow(await client.query(`SELECT ${functionName}($1,$2,$3,$4,$5,$6,$7,$8) result`,[tenantId,entityId,reviewId,periodId,expectedEvidenceHash,reason,idempotencyKey,requestHash]),'WBS_AUTOREC_EVENT_DRAFT_FAILED','AutoRec event Draft did not return a result').result;
    });
  }

  async finalizeWbsAutoRecG11Incur({tenantId,entityId,reviewId,expectedEvidenceHash,reason,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_wbs_autorec_g11_incur_hash($1,$2,$3,$4,$5) request_hash',
        [tenantId,entityId,reviewId,expectedEvidenceHash,reason]
      ),'WBS_AUTOREC_G11_INCUR_HASH_FAILED','AutoRec G11 INCUR hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_finalize_wbs_autorec_g11_incur($1,$2,$3,$4,$5,$6,$7) result',
        [tenantId,entityId,reviewId,expectedEvidenceHash,reason,idempotencyKey,requestHash]
      ),'WBS_AUTOREC_G11_INCUR_FAILED','AutoRec G11 INCUR did not return a result').result;
    });
  }

  async getWbsAutoRecG11Evidence({tenantId,entityId,reviewId}){
    return this.inSession(async client=>requireRow(await client.query(
      'SELECT refs_get_wbs_autorec_g11_evidence($1,$2,$3) result',[tenantId,entityId,reviewId]
    ),'WBS_AUTOREC_G11_EVIDENCE_READ_FAILED','AutoRec G11 evidence read did not return a result').result);
  }

  async getReconciliationSummary({tenantId,entityId,bankAccountRef,statementEndingDate}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_reconciliation_summary($1,$2,$3,$4::date)',
      [tenantId,entityId,bankAccountRef,statementEndingDate]
    )).rows.map(row=>({...row,statement_ending_date:publicDate(row.statement_ending_date)})));
  }

  async listReconciliationScopes({tenantId,entityId,limit=100}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_reconciliation_scopes($1,$2,$3)',
      [tenantId,entityId,limit]
    )).rows);
  }

  async listAdmittedWbsBankStatementReceipts({tenantId,entityId,bankAccountRef,limit=50}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_admitted_wbs_bank_statement_receipts($1,$2,$3,$4)',
      [tenantId,entityId,bankAccountRef,limit]
    )).rows);
  }

  async getAdmittedWbsBankStatementReceipt({tenantId,entityId,statementReceiptId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_admitted_wbs_bank_statement_receipt($1,$2,$3)',
      [tenantId,entityId,statementReceiptId]
    )).rows);
  }

  async listReconciliationWorksheet({tenantId,entityId,reconciliationId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_reconciliation_worksheet($1,$2,$3)',
      [tenantId,entityId,reconciliationId]
    )).rows.map(row=>({...row,transaction_date:publicDate(row.transaction_date)})));
  }

  async getSignedReconciliationSnapshot({tenantId,entityId,reconciliationId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_signed_reconciliation_snapshot($1,$2,$3)',
      [tenantId,entityId,reconciliationId]
    )).rows);
  }

  async startReconciliation(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_reconciliation_start_hash($1,$2,$3,$4::date,$5,$6,$7) AS request_hash',
        [args.tenantId,args.entityId,args.bankAccountRef,args.statementEndingDate,args.statementOpeningBalance,args.statementEndingBalance,args.reason]
      ),'RECONCILIATION_START_HASH_FAILED','Reconciliation start hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_start_reconciliation($1,$2,$3,$4::date,$5,$6,$7,$8,$9) AS result',
        [args.tenantId,args.entityId,args.bankAccountRef,args.statementEndingDate,args.statementOpeningBalance,args.statementEndingBalance,args.reason,args.idempotencyKey,requestHash]
      ),'RECONCILIATION_START_FAILED','Reconciliation start did not return a result').result;
    });
  }

  async startReconciliationFromAdmittedWbsStatement(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_wbs_statement_reconciliation_start_hash($1,$2,$3,$4) AS request_hash',
        [args.tenantId,args.entityId,args.statementReceiptId,args.reason]
      ),'WBS_STATEMENT_RECONCILIATION_START_HASH_FAILED','Admitted WBS statement reconciliation hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_start_reconciliation_from_wbs_statement($1,$2,$3,$4,$5,$6) AS result',
        [args.tenantId,args.entityId,args.statementReceiptId,args.reason,args.idempotencyKey,requestHash]
      ),'WBS_STATEMENT_RECONCILIATION_START_FAILED','Admitted WBS statement reconciliation did not return a result').result;
    });
  }

  async setReconciliationClearance(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_reconciliation_clearance_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [args.tenantId,args.entityId,args.reconciliationId,args.bankSourceId,args.expectedReconciliationVersion,args.expectedBankVersion,args.clear,args.reason]
      ),'RECONCILIATION_CLEARANCE_HASH_FAILED','Reconciliation clearance hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_set_reconciliation_clearance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [args.tenantId,args.entityId,args.reconciliationId,args.bankSourceId,args.expectedReconciliationVersion,args.expectedBankVersion,args.clear,args.reason,args.idempotencyKey,requestHash]
      ),'RECONCILIATION_CLEARANCE_FAILED','Reconciliation clearance did not return a result').result;
    });
  }

  async setReconciliationAdjustmentClearance(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_reconciliation_adjustment_clearance_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [args.tenantId,args.entityId,args.reconciliationId,args.bankSourceId,args.expectedReconciliationVersion,args.expectedBankVersion,args.clear,args.reason]
      ),'RECONCILIATION_ADJUSTMENT_CLEARANCE_HASH_FAILED','Reconciliation adjustment clearance hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_set_reconciliation_adjustment_clearance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [args.tenantId,args.entityId,args.reconciliationId,args.bankSourceId,args.expectedReconciliationVersion,args.expectedBankVersion,args.clear,args.reason,args.idempotencyKey,requestHash]
      ),'RECONCILIATION_ADJUSTMENT_CLEARANCE_FAILED','Reconciliation adjustment clearance did not return a result').result;
    });
  }

  async transitionReconciliation(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_reconciliation_transition_hash($1,$2,$3,$4,$5,$6) AS request_hash',
        [args.tenantId,args.entityId,args.reconciliationId,args.action,args.expectedVersion,args.reason]
      ),'RECONCILIATION_TRANSITION_HASH_FAILED','Reconciliation transition hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_transition_reconciliation_adjustment_aware($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [args.tenantId,args.entityId,args.reconciliationId,args.action,args.expectedVersion,args.reason,args.idempotencyKey,requestHash]
      ),'RECONCILIATION_TRANSITION_FAILED','Reconciliation transition did not return a result').result;
    });
  }

  async createReconciliationAdjustmentDraft(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_reconciliation_adjustment_draft_hash($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13) AS request_hash',
        [args.tenantId,args.entityId,args.reconciliationId,args.bankSourceId,args.expectedReconciliationVersion,args.periodId,args.journalNumber,args.journalDate,args.currency,args.description??null,JSON.stringify(args.lines),args.attachmentIds,args.reason]
      ),'RECONCILIATION_ADJUSTMENT_DRAFT_HASH_FAILED','Reconciliation adjustment Draft hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_create_reconciliation_adjustment_draft($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13,$14,$15) AS result',
        [args.tenantId,args.entityId,args.reconciliationId,args.bankSourceId,args.expectedReconciliationVersion,args.periodId,args.journalNumber,args.journalDate,args.currency,args.description??null,JSON.stringify(args.lines),args.attachmentIds,args.reason,args.idempotencyKey,requestHash]
      ),'RECONCILIATION_ADJUSTMENT_DRAFT_FAILED','Reconciliation adjustment Draft creation did not return a result').result;
    });
  }

  async createBankPaymentMatch(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_bank_match_hash($1,$2,$3,$4,$5,$6,$7) AS request_hash',
        [args.tenantId,args.entityId,args.bankSourceId,args.paymentOccurrenceId,args.expectedBankVersion,args.expectedOccurrenceVersion,args.reason]
      ),'BANK_MATCH_HASH_FAILED','Bank match hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_create_bank_payment_match($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
        [args.tenantId,args.entityId,args.bankSourceId,args.paymentOccurrenceId,args.expectedBankVersion,args.expectedOccurrenceVersion,args.reason,args.idempotencyKey,requestHash]
      ),'BANK_MATCH_FAILED','Bank match creation did not return a result').result;
    });
  }

  async unmatchBankPayment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_bank_unmatch_hash($1,$2,$3,$4,$5,$6) AS request_hash',
        [args.tenantId,args.entityId,args.bankSourceId,args.bankMatchId,args.expectedMatchVersion,args.reason]
      ),'BANK_UNMATCH_HASH_FAILED','Bank unmatch hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_unmatch_bank_payment($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [args.tenantId,args.entityId,args.bankSourceId,args.bankMatchId,args.expectedMatchVersion,args.reason,args.idempotencyKey,requestHash]
      ),'BANK_UNMATCH_FAILED','Bank unmatch did not return a result').result;
    });
  }

  async getFinancialStatements({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_financial_statements($1,$2,$3)',
      [tenantId,entityId,periodId]
    )).rows.map(row=>({...row,...(row.period_start===undefined?{}:{period_start:publicDate(row.period_start)}),...(row.period_end===undefined?{}:{period_end:publicDate(row.period_end)})})));
  }

  async getFinancialStatementSnapshot({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_financial_statement_snapshot($1,$2,$3)',
      [tenantId,entityId,periodId]
    )).rows);
  }

  async prepareFinancialStatementSnapshot({tenantId,entityId,periodId,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        "SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',$1::uuid,'entity_id',$2::uuid,'period_id',$3::uuid)) AS request_hash",
        [tenantId,entityId,periodId]
      ),'STATEMENT_SNAPSHOT_PREPARE_HASH_FAILED','Statement snapshot prepare hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_prepare_financial_statement_snapshot($1,$2,$3,$4,$5) AS result',
        [tenantId,entityId,periodId,idempotencyKey,requestHash]
      ),'STATEMENT_SNAPSHOT_PREPARE_FAILED','Statement snapshot proposal was not prepared').result;
    });
  }

  async approveFinancialStatementSnapshot({tenantId,entityId,proposalId,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        "SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',$1::uuid,'entity_id',$2::uuid,'proposal_id',$3::uuid)) AS request_hash",
        [tenantId,entityId,proposalId]
      ),'STATEMENT_SNAPSHOT_APPROVE_HASH_FAILED','Statement snapshot approval hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_approve_financial_statement_snapshot($1,$2,$3,$4,$5) AS result',
        [tenantId,entityId,proposalId,idempotencyKey,requestHash]
      ),'STATEMENT_SNAPSHOT_APPROVE_FAILED','Statement snapshot proposal was not approved').result;
    });
  }

  async getFinancialStatementPeriodComparison({tenantId,entityId,currentPeriodId,priorPeriodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_financial_statement_period_comparison($1,$2,$3,$4)',
      [tenantId,entityId,currentPeriodId,priorPeriodId]
    )).rows.map(row=>({...row,...(row.current_period_start===undefined?{}:{current_period_start:publicDate(row.current_period_start)}),...(row.current_period_end===undefined?{}:{current_period_end:publicDate(row.current_period_end)}),...(row.prior_period_start===undefined?{}:{prior_period_start:publicDate(row.prior_period_start)}),...(row.prior_period_end===undefined?{}:{prior_period_end:publicDate(row.prior_period_end)})})));
  }

  async getDimensionProfitability({tenantId,entityId,periodId,dimensionType,dimensionRef}){
    if(dimensionType==='LOT')return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_lot_profitability($1,$2,$3,$4)',
      [tenantId,entityId,periodId,dimensionRef]
    )).rows);
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_dimension_profitability($1,$2,$3,$4,$5)',
      [tenantId,entityId,periodId,dimensionType,dimensionRef]
    )).rows);
  }

  async getCashFlowClassification({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_cash_flow_classification($1,$2,$3)',
      [tenantId,entityId,periodId]
    )).rows);
  }

  async getCwipRollforward({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_cwip_rollforward($1,$2,$3)',
      [tenantId,entityId,periodId]
    )).rows);
  }

  async getConstructionLoanRollforward({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_construction_loan_rollforward($1,$2,$3)',
      [tenantId,entityId,periodId]
    )).rows);
  }

  async getPrepaidRollforward({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_prepaid_rollforward($1,$2,$3)',
      [tenantId,entityId,periodId]
    )).rows);
  }

  async getIntercompanyReconciliation({tenantId,entityId,periodId,counterpartyEntityId,counterpartyPeriodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_intercompany_reconciliation($1,$2,$3,$4,$5)',
      [tenantId,entityId,periodId,counterpartyEntityId,counterpartyPeriodId]
    )).rows);
  }

  async getBudgetVsActual({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_budget_vs_actual($1,$2,$3)',[tenantId,entityId,periodId]
    )).rows);
  }

  async getConsolidation({tenantId,entityId,periodId,groupRef}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_get_consolidation($1,$2,$3,$4)',[tenantId,entityId,periodId,groupRef]
    )).rows);
  }

  async getApAging({tenantId,entityId,asOfDate}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_ap_aging($1,$2,$3::date)',[tenantId,entityId,asOfDate]
    )).rows);
  }

  async getApControlTotal({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(periodId===undefined
      ?'SELECT * FROM refs_ap_control_total($1,$2)'
      :'SELECT * FROM refs_ap_control_total($1,$2,$3)',periodId===undefined?[tenantId,entityId]:[tenantId,entityId,periodId]
    )).rows);
  }

  async getArControlTotal({tenantId,entityId,periodId}){
    return this.inSession(async client=>(await client.query(periodId===undefined
      ?'SELECT * FROM refs_ar_control_total($1,$2)'
      :'SELECT * FROM refs_ar_control_total($1,$2,$3)',periodId===undefined?[tenantId,entityId]:[tenantId,entityId,periodId]
    )).rows);
  }

  async createArCreditMemo(args){
    return this.inSession(async client=>{
      const lines=typeof args.lines==='string'?args.lines:JSON.stringify(args.lines);
      const requestHash=requireRow(await client.query('SELECT refs_ar_credit_memo_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',[args.tenantId,args.entityId,args.periodId,args.memoNumber,args.memoDate,args.customerRef,args.customerName,args.amount,lines,args.reason]),'AR_CREDIT_MEMO_HASH_FAILED','AR credit memo hash was not produced').request_hash;
      const row=requireRow(await client.query('SELECT refs_create_ar_credit_memo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',[args.tenantId,args.entityId,args.periodId,args.memoNumber,args.memoDate,args.customerRef,args.customerName,args.amount,lines,args.reason,args.idempotencyKey,requestHash]),'AR_CREDIT_MEMO_FAILED','AR credit memo Draft creation did not return a result');
      return row.result;
    });
  }

  async applyArCreditMemo(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ar_credit_memo_allocation_hash($1,$2,$3,$4,$5,$6) AS request_hash',
        [args.tenantId,args.entityId,args.businessAdjustmentId,args.businessDocumentId,args.amount,args.reason]
      ),'AR_CREDIT_MEMO_ALLOCATION_HASH_FAILED','AR credit memo allocation hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_apply_ar_credit_memo($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [args.tenantId,args.entityId,args.businessAdjustmentId,args.businessDocumentId,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AR_CREDIT_MEMO_ALLOCATION_FAILED','AR credit memo allocation did not return a result');
      return row.result;
    });
  }

  async createArRefund(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ar_refund_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',
        [args.tenantId,args.entityId,args.periodId,args.sourceAdjustmentId,args.refundNumber,args.refundDate,args.cashAccountCode,args.amount,args.reason]
      ),'AR_REFUND_HASH_FAILED','AR refund hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ar_refund($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [args.tenantId,args.entityId,args.periodId,args.sourceAdjustmentId,args.refundNumber,args.refundDate,args.cashAccountCode,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AR_REFUND_FAILED','AR refund Draft creation did not return a result');
      return row.result;
    });
  }

  async createApPaymentReversal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_ap_payment_reversal_hash($1,$2,$3,$4,$5,$6,$7) AS request_hash',[args.tenantId,args.entityId,args.sourceOccurrenceId,args.periodId,args.journalNumber,args.journalDate,args.reason]),'AP_PAYMENT_REVERSAL_HASH_FAILED','AP payment reversal hash was not produced').request_hash;
      const row=requireRow(await client.query('SELECT refs_create_ap_payment_reversal($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[args.tenantId,args.entityId,args.sourceOccurrenceId,args.periodId,args.journalNumber,args.journalDate,args.reason,args.idempotencyKey,requestHash]),'AP_PAYMENT_REVERSAL_FAILED','AP payment reversal Draft creation did not return a result');
      return row.result;
    });
  }

  async transitionJournal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_journal_transition_hash($1,$2,$3,$4,$5,$6) AS request_hash',
        [args.tenantId,args.entityId,args.journalEntryId,args.action,args.expectedRevision,args.reason??null]
      ),'JOURNAL_TRANSITION_HASH_FAILED','Journal transition hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_transition_journal($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [args.tenantId,args.entityId,args.journalEntryId,args.action,args.expectedRevision,args.reason??null,args.idempotencyKey,requestHash]
      ),'JOURNAL_TRANSITION_FAILED','Journal transition did not return a result');
      return row.result;
    });
  }

  async postJournal(args){
    const requestHash=canonicalRequestHash({tenantId:args.tenantId,entityId:args.entityId,periodId:args.periodId,journalEntryId:args.journalEntryId,expectedRevision:args.expectedRevision});
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_post_journal($1,$2,$3,$4,$5,$6,$7,refs_current_actor()) AS result',
        [args.tenantId,args.entityId,args.periodId,args.journalEntryId,args.expectedRevision,args.idempotencyKey,requestHash]
      ),'POST_FAILED','Posting did not return a result');
      return row.result;
    });
  }

  async closePeriod(args){
    const requestHash=canonicalRequestHash({tenantId:args.tenantId,entityId:args.entityId,periodId:args.periodId,expectedVersion:args.expectedVersion});
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_close_period($1,$2,$3,$4,$5,$6,refs_current_actor()) AS result',
        [args.tenantId,args.entityId,args.periodId,args.expectedVersion,args.idempotencyKey,requestHash]
      ),'PERIOD_CLOSE_FAILED','Period close did not return a result');
      return row.result;
    });
  }

  async retireConfigSnapshot(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_config_retire_hash($1,$2,$3,$4,$5,$6,$7) AS request_hash',
        [args.kind,args.tenantId,args.entityId,args.snapshotId,args.expectedRevision,args.cutoff,args.reason]
      ),'CONFIG_RETIRE_HASH_FAILED','Configuration retirement hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_retire_config_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
        [args.kind,args.tenantId,args.entityId,args.snapshotId,args.expectedRevision,args.cutoff,args.reason,args.idempotencyKey,requestHash]
      ),'CONFIG_RETIRE_FAILED','Configuration retirement did not return a result');
      return row.result;
    });
  }

  async claimOutbox({tenantId,limit=100}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_claim_outbox($1,refs_current_actor(),$2)',[tenantId,limit]
    )).rows);
  }

  async completeOutbox({tenantId,eventId,success,error=null}){
    return this.inSession(client=>client.query(
      'SELECT refs_complete_outbox($1,$2,refs_current_actor(),$3,$4)',[tenantId,eventId,success,error]
    ));
  }
}
