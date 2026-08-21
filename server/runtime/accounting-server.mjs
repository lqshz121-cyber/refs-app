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
import {createAiAccountingApprovedSettingsAdapter} from './ai-accounting-approved-settings-adapter.mjs';
import {createAiAccountingApprovedDecisionService} from './ai-accounting-approved-decision-service.mjs';
import {projectAiAccountingDecisionControllerScan} from './ai-accounting-decision-controller-scan.mjs';
import {createAiAccrualCandidateAnalysisService} from './ai-accrual-candidate-analysis-service.mjs';
import {createAiInvoiceAccountingClassificationService} from './ai-invoice-accounting-classification-service.mjs';
import {createAiVendorInvoiceAnomalyService} from './ai-vendor-invoice-anomaly-service.mjs';
import {createAiVendorInvoiceFrequencyAnomalyService} from './ai-vendor-invoice-frequency-anomaly-service.mjs';
import {createAiVendorInvoiceAmountDropAnomalyService} from './ai-vendor-invoice-amount-drop-anomaly-service.mjs';
import {createAiVendorInvoiceNearDuplicateService} from './ai-vendor-invoice-near-duplicate-service.mjs';
import {createAiManualJournalRiskService} from './ai-manual-journal-risk-service.mjs';
import {createAiBankDuplicatePaymentService} from './ai-bank-duplicate-payment-service.mjs';
import {createAiBankUnusualPaymentService} from './ai-bank-unusual-payment-service.mjs';
import {createAiBankPayeeVendorMismatchService} from './ai-bank-payee-vendor-mismatch-service.mjs';
import {createAiVendorAccountingTreatmentDriftService} from './ai-vendor-accounting-treatment-drift-service.mjs';
import {createAiInvoiceSourceSupportReviewService} from './ai-invoice-source-support-review-service.mjs';
import {createAiVendorAccountCodingDriftService} from './ai-vendor-account-coding-drift-service.mjs';
import {createAiApInvoiceCutoffReviewService} from './ai-ap-invoice-cutoff-review-service.mjs';
import {createAiVendorPaymentTermsDriftService} from './ai-vendor-payment-terms-drift-service.mjs';
import {createAiNewVendorMaterialInvoiceReviewService} from './ai-new-vendor-material-invoice-review-service.mjs';
import {createAiVendorMonthlySpendAnomalyService} from './ai-vendor-monthly-spend-anomaly-service.mjs';
import {createAiFullControllerScanService} from './ai-full-controller-scan-service.mjs';
import {createAiCwipPostCompletionReviewService} from './ai-cwip-post-completion-review-service.mjs';
import {createAiConstructionLoanControllerScanService} from './ai-construction-loan-controller-scan-service.mjs';
import {detectFinancialStatementVarianceReviews} from './ai-financial-statement-variance-review.mjs';
import {detectBudgetVsActualReviews} from './ai-budget-vs-actual-review.mjs';
import {detectConstructionLoanBalanceReviews} from './ai-construction-loan-balance-review.mjs';
import {detectConstructionLoanDrawCwipReviews} from './ai-construction-loan-draw-cwip-review.mjs';
import {detectConstructionLoanProjectCostReviews} from './ai-construction-loan-project-cost-review.mjs';
import {projectPrepaidAmortizationControllerReviews} from './ai-prepaid-amortization-controller-review.mjs';
import {detectPrepaidBalanceReconciliationReviews} from './ai-prepaid-balance-reconciliation.mjs';
import {detectFixedAssetDepreciationGaps} from './ai-fixed-asset-depreciation-gap-review.mjs';
import {detectFixedAssetDepreciationReviews} from './ai-fixed-asset-depreciation-review.mjs';
import {detectFixedAssetPostedReconciliation} from './ai-fixed-asset-posted-reconciliation.mjs';
import {detectFixedAssetDisposalGaps} from './ai-fixed-asset-disposal-gap-review.mjs';
import {detectPostDisposalDepreciation} from './ai-fixed-asset-post-disposal-depreciation-review.mjs';
import {detectFixedAssetImpairmentReviews} from './ai-fixed-asset-impairment-review.mjs';
import {detectImpairmentPostedReconciliation} from './ai-fixed-asset-impairment-posted-reconciliation.mjs';
import {detectSecurityDepositLiabilityReviews} from './ai-security-deposit-liability-review.mjs';
import {detectBankGlBalanceReconciliationReviews} from './ai-bank-gl-balance-reconciliation.mjs';
import {detectApAgingRisks} from './ai-ap-aging-risk.mjs';
import {detectBalanceSheetAccountAgingReviews} from './ai-balance-sheet-account-aging-review.mjs';
import {detectIntercompanyCloseReviews} from './ai-intercompany-close-review.mjs';
import {analyzeClosingSettlement} from './ai-closing-settlement-review.mjs';
import {createWbsTestImportService} from './wbs-test-import-service.mjs';
import {createControlledTestAiWorkflowService} from './controlled-test-ai-workflow-service.mjs';
import {createControlledTestBankWorkflowService} from './controlled-test-bank-workflow-service.mjs';
import {createControlledTestBankMatchService} from './controlled-test-bank-match-service.mjs';

const INSURANCE_PC_MAPPING_READINESS="SELECT to_regprocedure('refs_record_wbs_insurance_pc_mapping_pre_admission(uuid,uuid,jsonb,jsonb)') IS NOT NULL AND to_regprocedure('refs_propose_wbs_insurance_pc_mapping_hash(uuid,uuid,uuid,text,text)') IS NOT NULL AND to_regprocedure('refs_create_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid,text,text,text,text)') IS NOT NULL AND to_regprocedure('refs_approve_wbs_insurance_pc_mapping_hash(uuid,uuid,uuid,bigint,text,text,uuid,text,date,date,text)') IS NOT NULL AND to_regprocedure('refs_approve_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid,bigint,text,text,uuid,text,date,date,text,text,text)') IS NOT NULL AND to_regprocedure('refs_read_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid)') IS NOT NULL AND to_regprocedure('refs_read_wbs_insurance_pc_mapping_trace(uuid,uuid,text,date)') IS NOT NULL AND to_regprocedure('refs_read_wbs_insurance_pc_mapping_admission_resume(uuid,uuid,uuid,text,uuid,text,text)') IS NOT NULL AND to_regprocedure('refs_ap_control_total(uuid,uuid,uuid)') IS NOT NULL AND to_regprocedure('refs_ar_control_total(uuid,uuid,uuid)') IS NOT NULL AND to_regprocedure('refs_record_wbs_final1_signed_control_total(uuid,uuid,uuid,jsonb,text)') IS NOT NULL AND to_regprocedure('refs_retain_wbs_final1_business_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text)') IS NOT NULL AND to_regprocedure('refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text)') IS NOT NULL AS ready";
const WBS_TEST_IMPORT_READINESS="SELECT to_regprocedure('refs_create_wbs_test_payable_draft_hash(uuid,uuid,uuid,jsonb,jsonb,integer)') IS NOT NULL AND to_regprocedure('refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)') IS NOT NULL AND to_regprocedure('refs_finalize_wbs_test_import_source_hash(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL AND to_regprocedure('refs_finalize_wbs_test_import_source(uuid,uuid,uuid,uuid,uuid,text,text)') IS NOT NULL AND to_regprocedure('refs_create_wbs_controlled_test_bank_scope_hash(uuid,uuid,uuid,text,jsonb,text)') IS NOT NULL AND to_regprocedure('refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text)') IS NOT NULL AND to_regprocedure('refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text)') IS NOT NULL AND to_regprocedure('refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid)') IS NOT NULL AND to_regprocedure('refs_list_reconciliation_adjustment_evidence(uuid,uuid,integer)') IS NOT NULL AND to_regprocedure('refs_wbs_test_bank_adjustment_draft_batch(uuid,uuid,uuid,uuid,uuid[],uuid[],text,text)') IS NOT NULL AND to_regprocedure('refs_wbs_test_bank_adjustment_submit_batch(uuid,uuid,uuid,uuid[],text)') IS NOT NULL AND to_regprocedure('refs_wbs_test_bank_adjustment_review_batch(uuid,uuid,uuid,uuid[],text)') IS NOT NULL AND to_regprocedure('refs_wbs_test_bank_adjustment_approve_batch(uuid,uuid,uuid,uuid[],text)') IS NOT NULL AND to_regprocedure('refs_wbs_test_bank_adjustment_post_clear_batch(uuid,uuid,uuid,uuid,uuid[],text,text)') IS NOT NULL AND to_regprocedure('refs_resolve_wbs_test_bank_match_fixture(uuid,uuid)') IS NOT NULL AS ready";
const CONTROLLED_TEST_AI_READINESS="SELECT to_regprocedure('refs_derive_controlled_test_ai_source_hash(uuid,uuid,uuid,text)') IS NOT NULL AND to_regprocedure('refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text)') IS NOT NULL AS ready";

export function createProductionAiAccountingSettingsAdapterFactory({kernelFor}={}){
  if(typeof kernelFor!=='function')throw new TypeError('Production AI accounting settings adapter factory requires the authenticated kernel factory');
  return principal=>{
    if(!principal||principal.trusted!==true||typeof principal.tenantId!=='string')throw new TypeError('Production AI accounting settings adapter requires a trusted principal');
    const kernel=kernelFor(principal);
    if(typeof kernel?.readApprovedWbsAiEntityPeriodSettings!=='function'||typeof kernel?.readAiAccountMasterBindings!=='function')throw new TypeError('Production AI accounting settings adapter requires approved-settings and account-master readers');
    return createAiAccountingApprovedSettingsAdapter({settingsReader:async({tenantId,entityId,periodId,readOnly})=>{
      if(tenantId!==principal.tenantId||readOnly!==true)throw Object.assign(new Error('AI accounting settings scope must match the authenticated tenant and remain read-only.'),{code:'AI_ACCOUNTING_SETTINGS_SCOPE_INVALID'});
      return kernel.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true});
    },accountMasterReader:async({tenantId,entityId,accountCodes,readOnly})=>{if(tenantId!==principal.tenantId||readOnly!==true)throw Object.assign(new Error('AI account-master scope must match the authenticated tenant and remain read-only.'),{code:'AI_ACCOUNTING_SETTINGS_SCOPE_INVALID'});return kernel.readAiAccountMasterBindings({tenantId,entityId,accountCodes});}});
  };
}

export function createProductionAiAccountingDecisionPacketServiceFactory({kernelFor,serviceBuilder}={}){
  if(typeof serviceBuilder!=='function')throw new TypeError('Production AI accounting decision service requires a server-side builder');
  const settingsAdapterFor=createProductionAiAccountingSettingsAdapterFactory({kernelFor});
  return principal=>{
    const service=serviceBuilder(Object.freeze({principal,kernel:kernelFor(principal),settingsAdapter:settingsAdapterFor(principal)}));
    if(!service||typeof service.analyze!=='function')throw new TypeError('AI accounting decision service builder must return an analyze service');
    return service;
  };
}

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
    const [wbs,prepaid,duplicate,bankDuplicate,vendorAmount,vendorFrequency,vendorDrop,vendorNearDuplicate,manualJournal,bank,cost,loan]=await Promise.all([
      kernel.listAiWbsExceptionFindings({tenantId,entityId,limit:20}),kernel.listAiPrepaidCoverageFindings({tenantId,entityId,limit:20}),
      kernel.listAiDuplicatePayableFindings({tenantId,entityId,limit:20}),kernel.listAiBankDuplicatePaymentFindings({tenantId,entityId,limit:20}),
      kernel.listAiVendorInvoiceAmountSpikeFindings({tenantId,entityId,limit:20}),kernel.listAiVendorInvoiceFrequencySpikeFindings({tenantId,entityId,limit:20}),kernel.listAiVendorInvoiceAmountDropFindings({tenantId,entityId,limit:20}),kernel.listAiVendorInvoiceNearDuplicateFindings({tenantId,entityId,limit:20}),kernel.listAiManualJournalRiskFindings({tenantId,entityId,limit:20}),kernel.listAiUnmatchedBankPaymentFindings({tenantId,entityId,limit:20}),
      kernel.listAiCostDimensionFindings({tenantId,entityId,limit:20}),kernel.listAiLoanReferenceFindings({tenantId,entityId,limit:20})
    ]);
    return [
      ...wbs.map(row=>({category:'WBS_EXCEPTION',row})),...prepaid.map(row=>({category:'PREPAID_COVERAGE',row})),
      ...duplicate.map(row=>({category:'DUPLICATE_PAYABLE',row})),...bankDuplicate.map(row=>({category:'BANK_DUPLICATE_PAYMENT',row})),...bank.map(row=>({category:'UNMATCHED_BANK_PAYMENT',row})),
      ...vendorAmount.map(row=>({category:'VENDOR_INVOICE_AMOUNT_SPIKE',row})),...vendorFrequency.map(row=>({category:'VENDOR_INVOICE_FREQUENCY_SPIKE',row})),...vendorDrop.map(row=>({category:'VENDOR_INVOICE_AMOUNT_DROP',row})),...vendorNearDuplicate.map(row=>({category:'VENDOR_INVOICE_NEAR_DUPLICATE',row})),...manualJournal.map(row=>({category:'MANUAL_JOURNAL_RISK',row})),
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
  const aiInvoiceAccountingClassificationServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiInvoiceAccountingClassificationService({
    classificationInputReader:scope=>kernel.readAiInvoiceClassificationSource(scope),duplicateFindingReader:({tenantId,entityId,accountingPeriodId,limit})=>kernel.listAiDuplicatePayableFindingsForPeriod({tenantId,entityId,periodId:accountingPeriodId,limit}),
    capitalizationPolicyReader:scope=>createProductionAiAccountingSettingsAdapterFactory({kernelFor})(principal).readCapitalizationPolicy(scope),
    materializeWriter:input=>kernel.materializeAiInvoiceAccountingClassifications(input)
  });};
  const aiAccountingSettingsAdapterFactory=createProductionAiAccountingSettingsAdapterFactory({kernelFor});
  const aiAccountingDecisionPacketServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiAccountingApprovedDecisionService({
    sourceReader:scope=>kernel.readAiInvoiceClassificationSource(scope),
    loanSourceReader:scope=>kernel.readAiConstructionLoanDecisionSource(scope),
    classificationService:aiInvoiceAccountingClassificationServiceFactory(principal),
    scheduleReader:scope=>kernel.listAiAmortizationSchedules(scope),
    settingsAdapter:aiAccountingSettingsAdapterFactory(principal)
  });};
  const aiVendorInvoiceAnomalyServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiVendorInvoiceAnomalyService({
    sourceReader:scope=>kernel.listSourceDocuments(scope),detailReader:scope=>kernel.getSourceDocumentDetail(scope),evidenceReader:scope=>kernel.getWbsProviderSignedSourceEvidence(scope),
    policyReader:({tenantId,entityId,currentAccountingPeriodId})=>kernel.getAiVendorInvoiceAnomalyPolicy({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId}),
    materializeWriter:input=>kernel.materializeAiVendorInvoiceAmountAnomalies(input)
  });};
  const aiVendorInvoiceFrequencyAnomalyServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiVendorInvoiceFrequencyAnomalyService({
    sourceReader:scope=>kernel.listSourceDocuments(scope),detailReader:scope=>kernel.getSourceDocumentDetail(scope),evidenceReader:scope=>kernel.getWbsProviderSignedSourceEvidence(scope),
    policyReader:({tenantId,entityId,currentAccountingPeriodId})=>kernel.getAiVendorInvoiceFrequencyAnomalyPolicy({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId}),
    materializeWriter:input=>kernel.materializeAiVendorInvoiceFrequencyAnomalies(input)
  });};
  const aiVendorInvoiceAmountDropAnomalyServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiVendorInvoiceAmountDropAnomalyService({
    sourceReader:scope=>kernel.listSourceDocuments(scope),detailReader:scope=>kernel.getSourceDocumentDetail(scope),evidenceReader:scope=>kernel.getWbsProviderSignedSourceEvidence(scope),
    policyReader:({tenantId,entityId,currentAccountingPeriodId})=>kernel.getAiVendorInvoiceAmountDropPolicy({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId}),
    materializeWriter:input=>kernel.materializeAiVendorInvoiceAmountDrops(input)
  });};
  const aiVendorInvoiceNearDuplicateServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiVendorInvoiceNearDuplicateService({
    sourceReader:scope=>kernel.listSourceDocuments(scope),detailReader:scope=>kernel.getSourceDocumentDetail(scope),evidenceReader:scope=>kernel.getWbsProviderSignedSourceEvidence(scope),
    policyReader:({tenantId,entityId,currentAccountingPeriodId})=>kernel.getAiVendorInvoiceNearDuplicatePolicy({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId}),
    materializeWriter:input=>kernel.materializeAiVendorInvoiceNearDuplicates(input)
  });};
  const aiManualJournalRiskServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiManualJournalRiskService({
    journalReader:scope=>kernel.listAiManualJournalRiskInputs(scope),
    policyReader:scope=>kernel.getAiManualJournalRiskPolicy(scope),
    materializeWriter:input=>kernel.materializeAiManualJournalRisks(input)
  });};
  const aiBankDuplicatePaymentServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiBankDuplicatePaymentService({
    sourceReader:({tenantId,entityId,currentAccountingPeriodId,limit})=>kernel.listAiBankDuplicatePaymentSources({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,limit}),
    materializeWriter:input=>kernel.materializeAiBankDuplicatePayments(input)
  });};
  const aiBankUnusualPaymentServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiBankUnusualPaymentService({
    sourceReader:({tenantId,entityId,currentAccountingPeriodId,limit})=>kernel.listAiBankUnusualPaymentSources({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,limit}),
    policyReader:({tenantId,entityId,currentAccountingPeriodId})=>kernel.getAiBankUnusualPaymentPolicy({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId})
  });};
  const aiBankPayeeVendorMismatchServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiBankPayeeVendorMismatchService({
    matchedPaymentReader:({tenantId,entityId,accountingPeriodId,limit})=>kernel.listAiBankPayeeVendorMatches({tenantId,entityId,accountingPeriodId,limit}),
    policyReader:({tenantId,entityId,accountingPeriodId})=>kernel.getAiBankPayeeVendorPolicy({tenantId,entityId,accountingPeriodId})
  });};
  const aiVendorAccountingTreatmentDriftServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiVendorAccountingTreatmentDriftService({
    classificationHistoryReader:({tenantId,entityId,accountingPeriodId,limit})=>kernel.listAiVendorAccountingTreatmentHistory({tenantId,entityId,accountingPeriodId,limit})
  });};
  const aiInvoiceSourceSupportReviewServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiInvoiceSourceSupportReviewService({
    sourceSupportReader:({tenantId,entityId,accountingPeriodId,limit})=>kernel.listAiInvoiceSourceSupportInputs({tenantId,entityId,accountingPeriodId,limit})
  });};
  const aiVendorAccountCodingDriftServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiVendorAccountCodingDriftService({
    postedCodingHistoryReader:({tenantId,entityId,accountingPeriodId,limit})=>kernel.listAiVendorAccountCodingHistory({tenantId,entityId,accountingPeriodId,limit})
  });};
  const aiApInvoiceCutoffReviewServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiApInvoiceCutoffReviewService({
    invoiceCutoffReader:({tenantId,entityId,accountingPeriodId,limit})=>kernel.listAiApInvoiceCutoffInputs({tenantId,entityId,accountingPeriodId,limit})
  });};
  const aiVendorPaymentTermsDriftServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiVendorPaymentTermsDriftService({
    paymentTermsHistoryReader:({tenantId,entityId,accountingPeriodId,limit})=>kernel.listAiVendorPaymentTermsHistory({tenantId,entityId,accountingPeriodId,limit})
  });};
  const aiNewVendorMaterialInvoiceReviewServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiNewVendorMaterialInvoiceReviewService({
    sourceReader:scope=>kernel.listSourceDocuments(scope),detailReader:scope=>kernel.getSourceDocumentDetail(scope),evidenceReader:scope=>kernel.getWbsProviderSignedSourceEvidence(scope),
    policyReader:({tenantId,entityId,accountingPeriodId})=>kernel.getAiNewVendorMaterialInvoicePolicy({tenantId,entityId,accountingPeriodId})
  });};
  const aiVendorMonthlySpendAnomalyServiceFactory=principal=>{const kernel=kernelFor(principal);return createAiVendorMonthlySpendAnomalyService({
    populationReader:({tenantId,entityId,currentAccountingPeriodId})=>kernel.readAiVendorMonthlySpendPopulation({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId})
  });};
  const aiFullControllerScanServiceFactory=principal=>{
    const kernel=kernelFor(principal),actions=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
    const adapt=(serviceFactory,periodKey='currentAccountingPeriodId')=>({analyze:async input=>{
      const service=serviceFactory(principal);return service.analyze({...input,[periodKey]:input.currentAccountingPeriodId});
    }});
    const accrual={analyze:async input=>{const result=await aiAccrualCandidateAnalysisServiceFactory(principal).analyze({tenantId:input.tenantId,entityId:input.entityId,currentPeriodId:input.currentAccountingPeriodId});return Object.freeze({schema_version:'AI_ACCRUAL_CONTROLLER_SCAN_BATCH_V1',current_accounting_period_id:input.currentAccountingPeriodId,excluded_explicit_non_accrual_evidence_count:result.excluded_explicit_non_accrual_evidence_count,finding_count:result.candidates.length,findings:result.candidates,action_flags:actions});}};
    const propertyRent={analyze:async input=>{const findings=await kernel.listAiPropertyRentRevenueReviews({tenantId:input.tenantId,entityId:input.entityId,periodId:input.currentAccountingPeriodId,limit:input.limit});return Object.freeze({schema_version:'AI_PROPERTY_RENT_REVENUE_SCAN_BATCH_V1',current_accounting_period_id:input.currentAccountingPeriodId,finding_count:findings.length,findings:Object.freeze(findings.map(row=>Object.freeze({...row,entity_id:input.entityId,accounting_period_id:input.currentAccountingPeriodId,action_flags:actions}))),action_flags:actions});}};
    const financialVariance={analyze:async input=>{const rows=await kernel.getAiFinancialStatementVarianceComparison({tenantId:input.tenantId,entityId:input.entityId,currentPeriodId:input.currentAccountingPeriodId}),policy=await kernel.getAiFinancialVariancePolicy({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId});if(!policy)throw Object.assign(new Error('Approved financial variance policy is required.'),{code:'AI_FINANCIAL_VARIANCE_POLICY_REQUIRED'});return Object.freeze({...detectFinancialStatementVarianceReviews(rows,{policy,limit:input.limit}),current_accounting_period_id:input.currentAccountingPeriodId});}};
    const budgetVariance={analyze:async input=>{const scope={tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId},[rows,policy]=await Promise.all([kernel.getAiBudgetVsActualSource(scope),kernel.getAiBudgetVariancePolicy(scope)]);if(!policy)throw Object.assign(new Error('Approved budget variance policy is required.'),{code:'AI_BUDGET_VARIANCE_POLICY_REQUIRED'});return Object.freeze({...detectBudgetVsActualReviews(rows,{policy,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)}),current_accounting_period_id:input.currentAccountingPeriodId});}};
    const constructionLoan={analyze:async input=>{const scope={tenantId:input.tenantId,entityId:input.entityId,periodId:input.currentAccountingPeriodId},[glRows,statementRows,policy]=await Promise.all([kernel.getConstructionLoanRollforward(scope),kernel.getAiConstructionLoanLenderBalances(scope),kernel.getAiConstructionLoanBalancePolicy(scope)]);if(!policy)throw Object.assign(new Error('Approved construction-loan balance policy is required.'),{code:'AI_CONSTRUCTION_LOAN_BALANCE_POLICY_REQUIRED'});return Object.freeze({...detectConstructionLoanBalanceReviews(glRows,statementRows,{entityId:input.entityId,policy,limit:input.limit}),current_accounting_period_id:input.currentAccountingPeriodId});}};
    const constructionLoanDrawCwip={analyze:async input=>{const reportScope={tenantId:input.tenantId,entityId:input.entityId,periodId:input.currentAccountingPeriodId},policyScope={tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId},[loanRows,cwipRows,policy]=await Promise.all([kernel.getConstructionLoanRollforward(reportScope),kernel.getCwipRollforward(reportScope),kernel.getAiConstructionLoanDrawCwipPolicy(policyScope)]);if(!policy)throw Object.assign(new Error('Approved construction-loan draw to CWIP policy is required.'),{code:'AI_LOAN_DRAW_CWIP_POLICY_REQUIRED'});return detectConstructionLoanDrawCwipReviews(loanRows,cwipRows,{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,policy});}};
    const constructionLoanProjectCost={analyze:async input=>{const scope={tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId},[rows,policy]=await Promise.all([kernel.getAiConstructionLoanProjectCostSource(scope),kernel.getAiConstructionLoanDrawCwipPolicy(scope)]);if(!policy)throw Object.assign(new Error('Approved construction-loan project-cost policy is required.'),{code:'AI_LOAN_PROJECT_COST_POLICY_REQUIRED'});return detectConstructionLoanProjectCostReviews(rows,{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,policy});}};
    const constructionLoanTransaction={analyze:async input=>createAiConstructionLoanControllerScanService({sourceReader:scope=>kernel.readAiConstructionLoanSource(scope)}).analyze({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const closingSettlement={analyze:async input=>analyzeClosingSettlement(await kernel.readAiClosingSettlementSource({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const prepaidAmortization={analyze:async input=>projectPrepaidAmortizationControllerReviews(await kernel.listInsurancePrepaidAmortization({tenantId:input.tenantId,entityId:input.entityId,periodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,100)}),{entityId:input.entityId,currentAccountingPeriodId:input.currentAccountingPeriodId})};
    const prepaidBalanceReconciliation={analyze:async input=>detectPrepaidBalanceReconciliationReviews(await kernel.getAiPrepaidBalanceReconciliationSource({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const fixedAssetDepreciation={analyze:async input=>detectFixedAssetDepreciationGaps(await kernel.getAiFixedAssetDepreciationGapSource({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const fixedAssetDepreciationSchedule={analyze:async input=>detectFixedAssetDepreciationReviews(await kernel.getAiFixedAssetDepreciationSource({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const fixedAssetPostedReconciliation={analyze:async input=>detectFixedAssetPostedReconciliation(await kernel.getAiFixedAssetPostedReconciliation({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const fixedAssetDisposalGap={analyze:async input=>{const scope={tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId},[rows,reviewed]=await Promise.all([kernel.getAiFixedAssetDisposalGapSource(scope),kernel.getAiReviewedFixedAssetDisposals(scope)]),reviewedIds=new Set(reviewed.map(item=>item.fixed_asset_register_evidence_id));return detectFixedAssetDisposalGaps(rows.filter(row=>!reviewedIds.has(row.fixed_asset_register_evidence_id)),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)});}};
    const fixedAssetPostDisposalDepreciation={analyze:async input=>detectPostDisposalDepreciation(await kernel.getAiFixedAssetPostDisposalDepreciation({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const fixedAssetImpairment={analyze:async input=>detectFixedAssetImpairmentReviews(await kernel.getAiFixedAssetImpairmentAssessments({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const fixedAssetImpairmentPosted={analyze:async input=>detectImpairmentPostedReconciliation(await kernel.getAiFixedAssetImpairmentPostedReconciliation({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const securityDepositLiability={analyze:async input=>detectSecurityDepositLiabilityReviews(await kernel.getAiSecurityDepositLiabilityReview({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const bankGlBalanceReconciliation={analyze:async input=>detectBankGlBalanceReconciliationReviews(await kernel.getAiBankGlBalanceReconciliation({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}),{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const apAging={analyze:async input=>{const period=await kernel.readAiAccrualAnalysisPeriod({tenantId:input.tenantId,entityId:input.entityId,currentPeriodId:input.currentAccountingPeriodId});if(!/^\d{4}-\d{2}-\d{2}$/.test(period.period_end||''))throw Object.assign(new Error('Accounting period end date is required for AP aging.'),{code:'AI_AP_AGING_PERIOD_END_REQUIRED'});const [rows,policy]=await Promise.all([kernel.getAiApAgingRiskSource({tenantId:input.tenantId,entityId:input.entityId,asOfDate:period.period_end}),kernel.getAiApAgingRiskPolicy({tenantId:input.tenantId,entityId:input.entityId,asOfDate:period.period_end})]);if(!policy)throw Object.assign(new Error('Approved AP aging policy is required.'),{code:'AI_AP_AGING_POLICY_REQUIRED'});return Object.freeze({...detectApAgingRisks(rows,{asOfDate:period.period_end,policy,limit:Math.min(input.limit,500)}),current_accounting_period_id:input.currentAccountingPeriodId});}};
    const balanceSheetAging={analyze:async input=>{const scope={tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId},[rows,policy]=await Promise.all([kernel.getAiBalanceSheetAccountAgingSource(scope),kernel.getAiBalanceSheetAgingPolicy(scope)]);if(!policy)throw Object.assign(new Error('Approved balance-sheet aging policy is required.'),{code:'AI_BALANCE_SHEET_AGING_POLICY_REQUIRED'});return detectBalanceSheetAccountAgingReviews(rows,{entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,policy,limit:Math.min(input.limit,500)});}};
    const intercompany={analyze:async input=>{const pairs=await kernel.listAiIntercompanyCounterpartyPeriods({tenantId:input.tenantId,entityId:input.entityId,periodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,100)}),findings=[];for(const pair of pairs){const rows=await kernel.getIntercompanyReconciliation({tenantId:input.tenantId,entityId:input.entityId,periodId:input.currentAccountingPeriodId,counterpartyEntityId:pair.counterparty_entity_id,counterpartyPeriodId:pair.counterparty_period_id}),batch=detectIntercompanyCloseReviews(rows,{entityId:input.entityId,counterpartyEntityId:pair.counterparty_entity_id,limit:Math.min(input.limit-findings.length,500)});for(const finding of batch.findings)findings.push(Object.freeze({...finding,accounting_period_id:input.currentAccountingPeriodId}));if(findings.length>=input.limit)break;}return Object.freeze({schema_version:'AI_INTERCOMPANY_FULL_CONTROLLER_SCAN_BATCH_V1',current_accounting_period_id:input.currentAccountingPeriodId,scanned_counterparty_count:pairs.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:actions});}};
    const bankReconciliation={analyze:async input=>{const findings=await kernel.listAiUnmatchedBankPaymentFindingsForPeriod({tenantId:input.tenantId,entityId:input.entityId,periodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,100)});return Object.freeze({schema_version:'AI_BANK_RECONCILIATION_EXCEPTION_SCAN_BATCH_V1',current_accounting_period_id:input.currentAccountingPeriodId,finding_count:findings.length,findings:Object.freeze(findings),action_flags:actions});}};
    const retainedFinding=(schemaVersion,reader)=>({analyze:async input=>{const rows=await reader({tenantId:input.tenantId,entityId:input.entityId,periodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,100)}),findings=rows.map(row=>Object.freeze({...row,entity_id:input.entityId,accounting_period_id:input.currentAccountingPeriodId,action_flags:actions}));return Object.freeze({schema_version:schemaVersion,current_accounting_period_id:input.currentAccountingPeriodId,finding_count:findings.length,findings:Object.freeze(findings),action_flags:actions});}});
    const prepaidCoverage=retainedFinding('AI_PREPAID_COVERAGE_SCAN_BATCH_V1',scope=>kernel.listAiPrepaidCoverageFindingsForPeriod(scope));
    const duplicatePayable=retainedFinding('AI_DUPLICATE_PAYABLE_SCAN_BATCH_V1',scope=>kernel.listAiDuplicatePayableFindingsForPeriod(scope));
    const costDimension=retainedFinding('AI_COST_DIMENSION_SCAN_BATCH_V1',scope=>kernel.listAiCostDimensionFindingsForPeriod(scope));
    const loanReference=retainedFinding('AI_LOAN_REFERENCE_SCAN_BATCH_V1',scope=>kernel.listAiLoanReferenceFindingsForPeriod(scope));
    const cwipPostCompletion={analyze:async input=>createAiCwipPostCompletionReviewService({postedCwipReader:scope=>kernel.readAiCwipPostCompletionSource(scope)}).analyze({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)})};
    const invoiceAccountingClassification={analyze:async input=>{
      const batch=await aiInvoiceAccountingClassificationServiceFactory(principal).analyze({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500),includeControllerEvidence:true});
      const presentation=Object.freeze({
        BLOCKED:Object.freeze({risk_level:'HIGH',suggested_action:'Resolve the missing, conflicting, or duplicate source evidence before selecting an accounting treatment.'}),
        PREPAID_AMORTIZATION:Object.freeze({risk_level:'MEDIUM',suggested_action:'Review the coverage period and prepare a human-reviewed prepaid amortization schedule.'}),
        ACCRUAL_REVIEW:Object.freeze({risk_level:'MEDIUM',suggested_action:'Review service timing and prepare a human-reviewed accrual and reversal proposal if supported.'}),
        CAPITALIZATION_REVIEW:Object.freeze({risk_level:'MEDIUM',suggested_action:'Review the approved capitalization policy, project evidence, and proposed capital account.'}),
        EXPENSE:Object.freeze({risk_level:'LOW',suggested_action:'Confirm the expense account and member coding before any Draft journal entry is prepared.'})
      });
      const findings=batch.results.map((row,index)=>{const consistency=batch.controller_evidence[index],base=presentation[row.classification];return Object.freeze({...row,entity_id:input.entityId,accounting_period_id:input.currentAccountingPeriodId,...base,...(consistency.status==='MISMATCH'?{risk_level:'HIGH',suggested_action:'Investigate and correct the Posted accounting treatment before period close.'}:{}),posted_treatment_consistency:consistency});});
      return Object.freeze({schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_CONTROLLER_SCAN_BATCH_V1',current_accounting_period_id:input.currentAccountingPeriodId,scanned_document_count:batch.scanned_document_count,eligible_invoice_line_count:batch.eligible_invoice_line_count,classification_counts:batch.classification_counts,finding_count:findings.length,findings:Object.freeze(findings),action_flags:actions});
    }};
    const accountingDecision={analyze:async input=>projectAiAccountingDecisionControllerScan(
      await aiAccountingDecisionPacketServiceFactory(principal).analyze({tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:Math.min(input.limit,500)}),
      {tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId}
    )};
    return createAiFullControllerScanService({analyzers:{
      ACCOUNTING_DECISION:accountingDecision,
      ACCRUAL_CANDIDATE:accrual,
      AP_AGING_RISK:apAging,
      BALANCE_SHEET_ACCOUNT_AGING:balanceSheetAging,
      AP_INVOICE_CUTOFF:adapt(aiApInvoiceCutoffReviewServiceFactory),
      BANK_DUPLICATE_PAYMENT:adapt(aiBankDuplicatePaymentServiceFactory),
      BANK_PAYEE_VENDOR_MISMATCH:adapt(aiBankPayeeVendorMismatchServiceFactory,'accountingPeriodId'),
      BANK_RECONCILIATION_EXCEPTION:bankReconciliation,
      BANK_GL_BALANCE_RECONCILIATION:bankGlBalanceReconciliation,
      BANK_UNUSUAL_PAYMENT:adapt(aiBankUnusualPaymentServiceFactory),
      BUDGET_VS_ACTUAL:budgetVariance,
      CONSTRUCTION_LOAN_BALANCE:constructionLoan,
      CONSTRUCTION_LOAN_DRAW_CWIP:constructionLoanDrawCwip,
      CONSTRUCTION_LOAN_PROJECT_COST:constructionLoanProjectCost,
      CONSTRUCTION_LOAN_TRANSACTION:constructionLoanTransaction,
      CLOSING_SETTLEMENT:closingSettlement,
      COST_DIMENSION:costDimension,
      CWIP_POST_COMPLETION:cwipPostCompletion,
      DUPLICATE_PAYABLE:duplicatePayable,
      FINANCIAL_STATEMENT_VARIANCE:financialVariance,
      FIXED_ASSET_DEPRECIATION:fixedAssetDepreciation,
      FIXED_ASSET_DEPRECIATION_SCHEDULE:fixedAssetDepreciationSchedule,
      FIXED_ASSET_POSTED_RECONCILIATION:fixedAssetPostedReconciliation,
      FIXED_ASSET_DISPOSAL_GAP:fixedAssetDisposalGap,
      FIXED_ASSET_POST_DISPOSAL_DEPRECIATION:fixedAssetPostDisposalDepreciation,
      FIXED_ASSET_IMPAIRMENT:fixedAssetImpairment,
      FIXED_ASSET_IMPAIRMENT_POSTED_RECONCILIATION:fixedAssetImpairmentPosted,
      INVOICE_ACCOUNTING_CLASSIFICATION:invoiceAccountingClassification,
      INVOICE_SOURCE_SUPPORT:adapt(aiInvoiceSourceSupportReviewServiceFactory,'accountingPeriodId'),
      INTERCOMPANY_CLOSE:intercompany,
      LOAN_REFERENCE:loanReference,
      MANUAL_JOURNAL_RISK:adapt(aiManualJournalRiskServiceFactory),
      NEW_VENDOR_MATERIAL_INVOICE:adapt(aiNewVendorMaterialInvoiceReviewServiceFactory,'accountingPeriodId'),
      PROPERTY_RENT_REVENUE:propertyRent,
      SECURITY_DEPOSIT_LIABILITY:securityDepositLiability,
      PREPAID_COVERAGE:prepaidCoverage,
      PREPAID_AMORTIZATION:prepaidAmortization,
      PREPAID_BALANCE_RECONCILIATION:prepaidBalanceReconciliation,
      VENDOR_ACCOUNT_CODING_DRIFT:adapt(aiVendorAccountCodingDriftServiceFactory,'accountingPeriodId'),
      VENDOR_ACCOUNTING_TREATMENT_DRIFT:adapt(aiVendorAccountingTreatmentDriftServiceFactory,'accountingPeriodId'),
      VENDOR_INVOICE_AMOUNT_DROP:adapt(aiVendorInvoiceAmountDropAnomalyServiceFactory),
      VENDOR_INVOICE_FREQUENCY:adapt(aiVendorInvoiceFrequencyAnomalyServiceFactory),
      VENDOR_INVOICE_NEAR_DUPLICATE:adapt(aiVendorInvoiceNearDuplicateServiceFactory),
      VENDOR_MONTHLY_SPEND:adapt(aiVendorMonthlySpendAnomalyServiceFactory),
      VENDOR_PAYMENT_TERMS_DRIFT:adapt(aiVendorPaymentTermsDriftServiceFactory,'accountingPeriodId'),
      VENDOR_SINGLE_INVOICE_SPIKE:adapt(aiVendorInvoiceAnomalyServiceFactory)
    }});
  };
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
    wbsTestImportServiceFactory:wbsTestImport?principal=>{
      const kernelForActor=actorId=>kernelFor({trusted:true,tenantId:wbsTestImport.tenantId,actorId});
      const authorizeBank=scope=>kernelFor(principal).assertWbsTestImport(scope);
      return Object.freeze({
        ...createWbsTestImportService({scope:wbsTestImport,resolveScope:selection=>kernelFor(principal).resolveWbsTestImportScope(selection),pilotService:createWbsLivePilotReadService({client:wbsLivePilotClient,authorize:scope=>kernelFor(principal).assertWbsAutoRecView(scope)}),authorizeBank,kernelForActor}),
        ...createControlledTestBankWorkflowService({scope:{...wbsTestImport,bankAccountRef:'WBS_TEST_BANK',cashAccountCode:'111000',offsetAccountCode:'610000'},authorize:authorizeBank,kernelForActor}),
        runBankMatch:createControlledTestBankMatchService({scope:{...wbsTestImport,bankAccountRef:'WBS_TEST_BANK',cashAccountCode:'111000'},authorize:authorizeBank,kernelForActor}).run
      });
    }:undefined,
    controlledTestAiWorkflowServiceFactory:controlledTestAiWorkflow?principal=>createControlledTestAiWorkflowService({scope:controlledTestAiWorkflow,kernelForActor:actorId=>kernelFor({trusted:true,tenantId:controlledTestAiWorkflow.tenantId,actorId})}):undefined,
    wbsOperatorAttestedPayableServiceFactory:wbsLivePilotClient?principal=>createWbsOperatorAttestedPayableService({client:wbsLivePilotClient,kernel:kernelFor(principal)}):undefined,
    wbsAdmittedPayableServiceFactory:wbsSnapshotVerifier?principal=>createWbsAdmittedPayableIngestion({kernel:kernelFor(principal),signatureVerifier:wbsSnapshotVerifier}):undefined,
    wbsProviderSignedPayableServiceFactory:wbsProviderSignedTrust?principal=>createWbsProviderSignedPayableAdmission({kernel:kernelFor(principal),providerTrust:wbsProviderSignedTrust,principal,serviceActorId:wbsProviderSignedServiceActorId}):undefined,
    wbsProviderFinal1RetainedEvidenceServiceFactory:wbsImmutableEvidenceStorage?principal=>createWbsProviderFinal1RetainedEvidenceAdmission({kernel:kernelFor(principal),storage:wbsImmutableEvidenceStorage,scanner:virusScanner,providerTrust:wbsProviderSignedTrust,principal,serviceActorId:wbsProviderSignedServiceActorId}):undefined,
    aiAnalysisExplanationServiceFactory,
    aiAccrualCandidateAnalysisServiceFactory,
    aiInvoiceAccountingClassificationServiceFactory,
    aiAccountingDecisionPacketServiceFactory,
    aiVendorInvoiceAnomalyServiceFactory,
    aiVendorInvoiceFrequencyAnomalyServiceFactory,
    aiVendorInvoiceAmountDropAnomalyServiceFactory,
    aiVendorInvoiceNearDuplicateServiceFactory,
    aiManualJournalRiskServiceFactory,
    aiBankDuplicatePaymentServiceFactory,
    aiBankUnusualPaymentServiceFactory,
    aiBankPayeeVendorMismatchServiceFactory,
    aiVendorAccountingTreatmentDriftServiceFactory,
    aiInvoiceSourceSupportReviewServiceFactory,
    aiVendorAccountCodingDriftServiceFactory,
    aiApInvoiceCutoffReviewServiceFactory,
    aiVendorPaymentTermsDriftServiceFactory,
    aiNewVendorMaterialInvoiceReviewServiceFactory,
    aiVendorMonthlySpendAnomalyServiceFactory,
    aiFullControllerScanServiceFactory,
    allowedOrigins,attachmentServiceFactory:attachmentEnabled?principal=>new AttachmentEvidenceService({storage:attachmentStorage,scanner:virusScanner,uploaderKernelFactory:kernelFor,
      scannerKernelFactory:()=>kernelFor({trusted:true,tenantId:principal.tenantId,actorId:scannerServiceActorId})})
      :undefined
  });
  Object.defineProperty(server,'aiGateway',{value:aiGateway||null,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiAnalysisExplanationService',{value:aiAnalysisExplanationServiceFactory||null,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiAccrualCandidateAnalysisService',{value:aiAccrualCandidateAnalysisServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiInvoiceAccountingClassificationService',{value:aiInvoiceAccountingClassificationServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiVendorInvoiceAnomalyService',{value:aiVendorInvoiceAnomalyServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiVendorInvoiceFrequencyAnomalyService',{value:aiVendorInvoiceFrequencyAnomalyServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiVendorInvoiceAmountDropAnomalyService',{value:aiVendorInvoiceAmountDropAnomalyServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiVendorInvoiceNearDuplicateService',{value:aiVendorInvoiceNearDuplicateServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiManualJournalRiskService',{value:aiManualJournalRiskServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiBankDuplicatePaymentService',{value:aiBankDuplicatePaymentServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiBankUnusualPaymentService',{value:aiBankUnusualPaymentServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiBankPayeeVendorMismatchService',{value:aiBankPayeeVendorMismatchServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiVendorAccountingTreatmentDriftService',{value:aiVendorAccountingTreatmentDriftServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiInvoiceSourceSupportReviewService',{value:aiInvoiceSourceSupportReviewServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiVendorAccountCodingDriftService',{value:aiVendorAccountCodingDriftServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiApInvoiceCutoffReviewService',{value:aiApInvoiceCutoffReviewServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiVendorPaymentTermsDriftService',{value:aiVendorPaymentTermsDriftServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiNewVendorMaterialInvoiceReviewService',{value:aiNewVendorMaterialInvoiceReviewServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiVendorMonthlySpendAnomalyService',{value:aiVendorMonthlySpendAnomalyServiceFactory,writable:false,enumerable:false,configurable:false});
  Object.defineProperty(server,'createAiFullControllerScanService',{value:aiFullControllerScanServiceFactory,writable:false,enumerable:false,configurable:false});
  return server;
}
