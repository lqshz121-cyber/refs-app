import {createAccountingHttpServer} from '../api/accounting-http.mjs';
import {PostgresContextIssuer} from './context-issuer.mjs';
import {PostgresAccountingKernel} from './kernel-repository.mjs';
import {AttachmentEvidenceService} from './attachment-storage.mjs';
import {createWbsInboundAutoRecHttpReadService} from './wbs-inbound-autorec-http-read-service.mjs';
import {grantStage1ReadAccess,upgradeStage1ControlledTestWorkflowAccess,upgradeStage1WbsOperatorAccess,upgradeStage1WbsReadAccess} from './stage1-bootstrap.mjs';
import {createWbsLivePilotReadService} from './wbs-live-pilot-read-service.mjs';
import {createWbsOperatorAttestedPayableService} from './wbs-operator-attested-payable.mjs';
import {createWbsAdmittedPayableIngestion} from './wbs-admitted-payable-ingestion.mjs';
import {createWbsProviderSignedPayableAdmission} from './wbs-provider-signed-payable-admission.mjs';
import {createWbsProviderFinal1RetainedEvidenceAdmission} from './wbs-provider-final1-retained-evidence-admission.mjs';
import {createAiAnalysisExplanationService} from './ai-analysis-explanation-service.mjs';
import {createAiAccrualCandidateAnalysisService} from './ai-accrual-candidate-analysis-service.mjs';
import {createWbsTestImportService} from './wbs-test-import-service.mjs';
import {createControlledTestAiWorkflowService} from './controlled-test-ai-workflow-service.mjs';

const INSURANCE_PC_MAPPING_READINESS="SELECT to_regprocedure('refs_record_wbs_insurance_pc_mapping_pre_admission(uuid,uuid,jsonb,jsonb)') IS NOT NULL AND to_regprocedure('refs_propose_wbs_insurance_pc_mapping_hash(uuid,uuid,uuid,text,text)') IS NOT NULL AND to_regprocedure('refs_create_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid,text,text,text,text)') IS NOT NULL AND to_regprocedure('refs_approve_wbs_insurance_pc_mapping_hash(uuid,uuid,uuid,bigint,text,text,uuid,text,date,date,text)') IS NOT NULL AND to_regprocedure('refs_approve_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid,bigint,text,text,uuid,text,date,date,text,text,text)') IS NOT NULL AND to_regprocedure('refs_read_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid)') IS NOT NULL AND to_regprocedure('refs_read_wbs_insurance_pc_mapping_trace(uuid,uuid,text,date)') IS NOT NULL AND to_regprocedure('refs_read_wbs_insurance_pc_mapping_admission_resume(uuid,uuid,uuid,text,uuid,text,text)') IS NOT NULL AND to_regprocedure('refs_ap_control_total(uuid,uuid,uuid)') IS NOT NULL AND to_regprocedure('refs_ar_control_total(uuid,uuid,uuid)') IS NOT NULL AND to_regprocedure('refs_record_wbs_final1_signed_control_total(uuid,uuid,uuid,jsonb,text)') IS NOT NULL AND to_regprocedure('refs_retain_wbs_final1_business_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text)') IS NOT NULL AND to_regprocedure('refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text)') IS NOT NULL AS ready";
const WBS_TEST_IMPORT_READINESS="SELECT to_regprocedure('refs_create_wbs_test_payable_draft_hash(uuid,uuid,uuid,jsonb,jsonb,integer)') IS NOT NULL AND to_regprocedure('refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)') IS NOT NULL AND to_regprocedure('refs_finalize_wbs_test_import_source_hash(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL AND to_regprocedure('refs_finalize_wbs_test_import_source(uuid,uuid,uuid,uuid,uuid,text,text)') IS NOT NULL AND to_regprocedure('refs_create_wbs_controlled_test_bank_scope_hash(uuid,uuid,uuid,text,jsonb,text)') IS NOT NULL AND to_regprocedure('refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)') IS NOT NULL AS ready";
const CONTROLLED_TEST_AI_READINESS="SELECT to_regprocedure('refs_derive_controlled_test_ai_source_hash(uuid,uuid,uuid,text)') IS NOT NULL AND to_regprocedure('refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text)') IS NOT NULL AS ready";

export function createProductionAccountingServer({runtimePool,issuerPool,grantSyncPool,stage1SelfGrant,stage1SelfWbsReadUpgrade,stage1SelfWbsOperatorUpgrade,stage1SelfControlledTestWorkflowUpgrade,authenticator,attachmentStorage,wbsImmutableEvidenceStorage,virusScanner,scannerServiceActorId,wbsSnapshotVerifier,wbsSignedBankAdmissionVerifier,wbsAutoRecTransitionContractVerifier,wbsLivePilotClient,wbsTestImport,controlledTestAiWorkflow,wbsProviderSignedTrust,wbsProviderSignedServiceActorId,aiGateway,runtimeLoginAllowlist=['refs_runtime'],maxBodyBytes,releaseSha,allowedOrigins=[]}={}){
  if(!runtimePool||!issuerPool||typeof authenticator?.authenticate!=='function')throw new Error('Production accounting server requires runtime pool, isolated issuer pool and authenticator');
  const attachmentEnabled=Boolean(attachmentStorage||virusScanner||scannerServiceActorId);
  if(attachmentEnabled&&(!attachmentStorage||!virusScanner||!scannerServiceActorId))throw new Error('Attachment integration requires object storage, virus scanner and scanner identity together');
  if(wbsSnapshotVerifier!=null&&typeof wbsSnapshotVerifier!=='function')throw new Error('WBS snapshot verifier must be a function when configured');
  if(wbsSignedBankAdmissionVerifier!=null&&typeof wbsSignedBankAdmissionVerifier!=='function')throw new Error('WBS signed bank admission verifier must be a function when configured');
  if(wbsAutoRecTransitionContractVerifier!=null&&typeof wbsAutoRecTransitionContractVerifier!=='function')throw new Error('WBS AutoRec transition-contract verifier must be a function when configured');
  if(Boolean(wbsProviderSignedTrust)!==Boolean(wbsProviderSignedServiceActorId))throw new Error('Provider signed WBS admission requires pinned trust and service actor identity together');
  if(Boolean(wbsImmutableEvidenceStorage)!==Boolean(wbsProviderSignedTrust))throw new Error('Final-1 retained evidence requires immutable WBS storage, pinned trust, and service actor together');
  if(aiGateway!=null&&typeof aiGateway.analyzeJson!=='function')throw new Error('AI gateway must expose analyzeJson when configured');
  if((stage1SelfGrant!=null||stage1SelfWbsReadUpgrade!=null||stage1SelfWbsOperatorUpgrade!=null||stage1SelfControlledTestWorkflowUpgrade!=null)&&!grantSyncPool)throw new Error('Stage 1 self-grant requires the isolated grant-sync pool');
  if(wbsTestImport&&!wbsLivePilotClient)throw new Error('WBS test import requires the configured live-pilot client');
  const kernelFor=principal=>{const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>principal});return new PostgresAccountingKernel(runtimePool,{runtimeLoginAllowlist,wbsSnapshotVerifier,wbsSignedBankAdmissionVerifier,wbsAutoRecTransitionContractVerifier,sessionProvider:()=>issuer.issue({tenantId:principal.tenantId})});};
  const aiAnalysisExplanationServiceFactory=aiGateway?principal=>{const kernel=kernelFor(principal);return createAiAnalysisExplanationService({gateway:aiGateway,auditRepository:kernel,summaryReader:async({tenantId,entityId})=>{
    if(tenantId!==principal.tenantId)throw new Error('AI analysis tenant scope does not match the authenticated principal');
    return kernel.readAiAccountingAnalysisSummary({tenantId,entityId});
  },evidenceReader:async({tenantId,entityId})=>{
    if(tenantId!==principal.tenantId)throw new Error('AI analysis tenant scope does not match the authenticated principal');
    const [wbs,prepaid,duplicate,bank,cost,loan]=await Promise.all([
      kernel.listAiWbsExceptionFindings({tenantId,entityId,limit:20}),kernel.listAiPrepaidCoverageFindings({tenantId,entityId,limit:20}),
      kernel.listAiDuplicatePayableFindings({tenantId,entityId,limit:20}),kernel.listAiUnmatchedBankPaymentFindings({tenantId,entityId,limit:20}),
      kernel.listAiCostDimensionFindings({tenantId,entityId,limit:20}),kernel.listAiLoanReferenceFindings({tenantId,entityId,limit:20})
    ]);
    return [
      ...wbs.map(row=>({category:'WBS_EXCEPTION',row})),...prepaid.map(row=>({category:'PREPAID_COVERAGE',row})),
      ...duplicate.map(row=>({category:'DUPLICATE_PAYABLE',row})),...bank.map(row=>({category:'UNMATCHED_BANK_PAYMENT',row})),
      ...cost.map(row=>({category:'COST_DIMENSION',row})),...loan.map(row=>({category:'LOAN_REFERENCE',row}))
    ];
  }});}:undefined;
  const aiAccrualCandidateAnalysisServiceFactory=principal=>{const kernel=kernelFor(principal);const analysis=createAiAccrualCandidateAnalysisService({
    retainedHistoryReader:async({tenantId,entityId,currentPeriodId})=>{
      if(tenantId!==principal.tenantId)throw new Error('AI accrual tenant scope does not match the authenticated principal');
      return kernel.listAiAccrualRetainedHistory({tenantId,entityId,currentPeriodId});
    },
    currentSourceReader:async({tenantId,entityId,currentPeriodId,recurringObligationId})=>{
      if(tenantId!==principal.tenantId)throw new Error('AI accrual tenant scope does not match the authenticated principal');
      return kernel.listAiAccrualCurrentSourceIds({tenantId,entityId,currentPeriodId,recurringObligationId});
    },
    postedSourceReader:async({tenantId,entityId,currentPeriodId,recurringObligationId})=>{
      if(tenantId!==principal.tenantId)throw new Error('AI accrual tenant scope does not match the authenticated principal');
      return kernel.listAiAccrualPostedSourceIds({tenantId,entityId,currentPeriodId,recurringObligationId});
    }
  });return {analyze:async({tenantId,entityId,currentPeriodId})=>{
    if(tenantId!==principal.tenantId)throw new Error('AI accrual tenant scope does not match the authenticated principal');
    const period=await kernel.readAiAccrualAnalysisPeriod({tenantId,entityId,currentPeriodId});
    return analysis.analyze({tenantId,entityId,currentPeriodId,companyCode:period.company_code,currentPeriodKey:period.period_code,currentPeriodOrdinal:Number(period.period_ordinal)});
  }};};
  const server=createAccountingHttpServer({
    maxBodyBytes,releaseSha,
    healthCheck:async()=>{try{const checks=[runtimePool.query('SELECT 1 AS ready'),issuerPool.query('SELECT 1 AS ready'),runtimePool.query(INSURANCE_PC_MAPPING_READINESS)];if(wbsTestImport)checks.push(runtimePool.query(WBS_TEST_IMPORT_READINESS));if(controlledTestAiWorkflow)checks.push(runtimePool.query(CONTROLLED_TEST_AI_READINESS));if(attachmentEnabled)checks.push(attachmentStorage.probe(),virusScanner.probe());if(wbsImmutableEvidenceStorage)checks.push(wbsImmutableEvidenceStorage.probeImmutable());const [runtime,issuer,...dependencies]=await Promise.all(checks);return runtime.rowCount===1&&issuer.rowCount===1&&dependencies.every(result=>result===true||result?.rows?.[0]?.ready===true||result===undefined);}catch{return false;}},
    authenticate:request=>authenticator.authenticate(request),
    kernelFactory:kernelFor,
    stage1SelfGrantServiceFactory:stage1SelfGrant?principal=>({
      grant:async({entityId,idempotencyKey})=>{
        if(principal.tenantId!==stage1SelfGrant.tenantId||entityId!==stage1SelfGrant.entityId){
          const error=new Error('This signed-in identity is not configured for the Stage 1 read scope');error.code='42501';throw error;
        }
        return grantStage1ReadAccess(grantSyncPool,{...stage1SelfGrant,actorId:principal.actorId,idempotencyKey});
      }
    }):undefined,
    stage1SelfWbsReadUpgradeServiceFactory:stage1SelfWbsReadUpgrade?principal=>({
      upgrade:async({entityId,idempotencyKey})=>{
        if(principal.tenantId!==stage1SelfWbsReadUpgrade.tenantId||entityId!==stage1SelfWbsReadUpgrade.entityId){
          const error=new Error('This signed-in identity is not configured for the Stage 1 WBS read scope');error.code='42501';throw error;
        }
        return upgradeStage1WbsReadAccess(grantSyncPool,{...stage1SelfWbsReadUpgrade,actorId:principal.actorId,idempotencyKey});
      }
    }):undefined,
    stage1SelfWbsOperatorUpgradeServiceFactory:stage1SelfWbsOperatorUpgrade?principal=>({
      upgrade:async({entityId,idempotencyKey})=>{
        if(principal.tenantId!==stage1SelfWbsOperatorUpgrade.tenantId||entityId!==stage1SelfWbsOperatorUpgrade.entityId){
          const error=new Error('This signed-in identity is not configured for the Stage 1 WBS operator scope');error.code='42501';throw error;
        }
        return upgradeStage1WbsOperatorAccess(grantSyncPool,{...stage1SelfWbsOperatorUpgrade,actorId:principal.actorId,idempotencyKey});
      }
    }):undefined,
    stage1SelfControlledTestWorkflowUpgradeServiceFactory:stage1SelfControlledTestWorkflowUpgrade?principal=>({
      upgrade:async({entityId,idempotencyKey})=>{
        if(principal.tenantId!==stage1SelfControlledTestWorkflowUpgrade.tenantId||entityId!==stage1SelfControlledTestWorkflowUpgrade.entityId){
          const error=new Error('This signed-in identity is not configured for the controlled test workflow scope');error.code='42501';throw error;
        }
        return upgradeStage1ControlledTestWorkflowAccess(grantSyncPool,{...stage1SelfControlledTestWorkflowUpgrade,actorId:principal.actorId,idempotencyKey});
      }
    }):undefined,
    wbsReadServiceFactory:principal=>createWbsInboundAutoRecHttpReadService({kernel:kernelFor(principal)}),
    wbsLivePilotServiceFactory:wbsLivePilotClient?principal=>createWbsLivePilotReadService({client:wbsLivePilotClient,authorize:scope=>kernelFor(principal).assertWbsAutoRecView(scope)}):undefined,
    wbsTestImportServiceFactory:wbsTestImport?principal=>createWbsTestImportService({scope:wbsTestImport,pilotService:createWbsLivePilotReadService({client:wbsLivePilotClient,authorize:scope=>kernelFor(principal).assertWbsAutoRecView(scope)}),authorizeBank:scope=>kernelFor(principal).assertWbsTestImport(scope),kernelForActor:actorId=>kernelFor({trusted:true,tenantId:wbsTestImport.tenantId,actorId})}):undefined,
    controlledTestAiWorkflowServiceFactory:controlledTestAiWorkflow?principal=>createControlledTestAiWorkflowService({scope:controlledTestAiWorkflow,kernelForActor:actorId=>kernelFor({trusted:true,tenantId:controlledTestAiWorkflow.tenantId,actorId})}):undefined,
    wbsOperatorAttestedPayableServiceFactory:wbsLivePilotClient?principal=>createWbsOperatorAttestedPayableService({client:wbsLivePilotClient,kernel:kernelFor(principal)}):undefined,
    wbsAdmittedPayableServiceFactory:wbsSnapshotVerifier?principal=>createWbsAdmittedPayableIngestion({kernel:kernelFor(principal),signatureVerifier:wbsSnapshotVerifier}):undefined,
    wbsProviderSignedPayableServiceFactory:wbsProviderSignedTrust?principal=>createWbsProviderSignedPayableAdmission({kernel:kernelFor(principal),providerTrust:wbsProviderSignedTrust,principal,serviceActorId:wbsProviderSignedServiceActorId}):undefined,
    wbsProviderFinal1RetainedEvidenceServiceFactory:wbsImmutableEvidenceStorage?principal=>createWbsProviderFinal1RetainedEvidenceAdmission({kernel:kernelFor(principal),storage:wbsImmutableEvidenceStorage,scanner:virusScanner,providerTrust:wbsProviderSignedTrust,principal,serviceActorId:wbsProviderSignedServiceActorId}):undefined,
    aiAnalysisExplanationServiceFactory,
    aiAccrualCandidateAnalysisServiceFactory,
    allowedOrigins,attachmentServiceFactory:attachmentEnabled?principal=>new AttachmentEvidenceService({storage:attachmentStorage,scanner:virusScanner,uploaderKernelFactory:kernelFor,
      scannerKernelFactory:()=>kernelFor({trusted:true,tenantId:principal.tenantId,actorId:scannerServiceActorId})})
      :undefined
  });
  Object.defineProperty(server,'aiGateway',{value:aiGateway||null,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiAnalysisExplanationService',{value:aiAnalysisExplanationServiceFactory||null,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiAccrualCandidateAnalysisService',{value:aiAccrualCandidateAnalysisServiceFactory,writable:false,enumerable:false,configurable:false});
  return server;
}
