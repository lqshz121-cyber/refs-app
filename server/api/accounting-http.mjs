import {createServer} from 'node:http';
import {WbsReadContractError,assertWbsControlReadOnlyResult,assertWbsReadOnlyResult,parseWbsAutoRecReviewSelection,parseWbsControlReconciliationSelection} from './wbs-read-contract.mjs';
import {WbsLivePilotError,assertWbsLivePilotResult,parseWbsLivePilotSelection} from '../runtime/wbs-live-pilot-read-service.mjs';
import {WbsAdmittedPayableIngestionError} from '../runtime/wbs-admitted-payable-ingestion.mjs';
import {WbsOperatorAttestedPayableError} from '../runtime/wbs-operator-attested-payable.mjs';
import {WbsSignedBankAdmissionError} from '../runtime/wbs-signed-bank-admission.mjs';
import {WbsProviderSignedPayableAdmissionError} from '../runtime/wbs-provider-signed-payable-admission.mjs';
import {WbsProviderFinal1RetainedEvidenceError} from '../runtime/wbs-provider-final1-retained-evidence-admission.mjs';
import {AiAnalysisExplanationError} from '../runtime/ai-analysis-explanation-service.mjs';
import {AI_ACCOUNTING_SKILL_REGISTRY_VERSION,AI_ACCOUNTING_SKILLS} from '../runtime/ai-accounting-skill-registry.mjs';
import {WbsCompanyCatalogControllerError,normalizeWbsCompanyCatalogCandidate,normalizeWbsCompanyClassification} from '../runtime/wbs-company-catalog-controller.mjs';
import {assertInsurancePcMappingDto} from '../runtime/wbs-insurance-pc-mapping-controller.mjs';
import {WbsTestImportError,assertWbsControlledTestBankResult,assertWbsTestImportResult,assertWbsTestRangeImportResult} from '../runtime/wbs-test-import-service.mjs';
import {ControlledTestAiWorkflowError,assertControlledTestAiWorkflowResult} from '../runtime/controlled-test-ai-workflow-service.mjs';
import {ControlledTestBankWorkflowError,assertControlledTestBankRangeWorkflowResult,assertControlledTestBankWorkflowPartialResult,assertControlledTestBankWorkflowResult} from '../runtime/controlled-test-bank-workflow-service.mjs';
import {ControlledTestBankMatchError,assertControlledTestBankMatchResult} from '../runtime/controlled-test-bank-match-service.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AI_ACCRUAL_HASH=/^sha256:[0-9a-f]{64}$/;
const AI_ACCRUAL_MONEY4=/^-?[0-9]+\.[0-9]{4}$/;
const AI_ACCRUAL_PERIOD=/^\d{4}-(?:0[1-9]|1[0-2])$/;
const AI_ACCRUAL_TRACE_KEYS=['accounting_period_id','amount','currency','obligation_status','period_key','recurring_obligation_id','service_frequency','service_period_end','service_period_start','source_document_id','source_document_line_id','source_line_hash','source_payload_hash'];
const AI_ACCRUAL_CANDIDATE_KEYS=['accounting_period_id','can_approve','can_create_draft','can_post','can_review','currency','entity_id','historical_amounts','period_key','prior_source_trace','recurring_obligation_id','required_human_fields','rule_id','service_frequency','status'];
const AI_ACCRUAL_HUMAN_FIELDS=['owner','due_date','accrual_basis','account_mapping','member_trace','reversing_entry_decision'];
const AI_INVOICE_CLASSIFICATION_KEYS=['action_flags','classification','confidence','policy_evidence','reason','required_human_fields','rule_id','schema_version','source_document_id','source_document_line_id','source_line_hash','source_payload_hash'].sort();
const AI_CAPITALIZATION_POLICY_KEYS=['capitalization_threshold','charge_code_classification','currency','eligible_cost_classes','policy_version','post_completion_treatment','project_status_by_ref','rule_id','schema_version','setting_snapshot_hash','setting_snapshot_id','useful_life_months_by_cost_class'].sort();
const AI_INVOICE_CLASSIFICATIONS=new Set(['EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW','BLOCKED']);
const safeNoAccountingActions=value=>exactKeys(value,['can_approve','can_create_draft','can_post','can_review'])&&value.can_create_draft===false&&value.can_review===false&&value.can_approve===false&&value.can_post===false;
const safeAiCapitalizationPolicy=value=>value===null||exactKeys(value,AI_CAPITALIZATION_POLICY_KEYS)&&value.schema_version==='AI_CAPITALIZATION_POLICY_EVIDENCE_V1'&&UUID.test(value.setting_snapshot_id||'')&&AI_ACCRUAL_HASH.test(value.setting_snapshot_hash||'')&&Number.isSafeInteger(value.policy_version)&&value.policy_version>0&&value.rule_id==='AI_CAPITALIZATION_POLICY_V1'&&/^[A-Z]{3}$/.test(value.currency||'')&&/^\d+\.\d{4}$/.test(value.capitalization_threshold||'')&&Array.isArray(value.eligible_cost_classes)&&typeof value.charge_code_classification==='object'&&typeof value.project_status_by_ref==='object'&&typeof value.useful_life_months_by_cost_class==='object'&&value.post_completion_treatment==='EXPENSE_OR_RECLASS_REVIEW';
const safeAiInvoiceClassification=value=>exactKeys(value,AI_INVOICE_CLASSIFICATION_KEYS)&&value.schema_version==='AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2'&&UUID.test(value.source_document_id||'')&&UUID.test(value.source_document_line_id||'')&&AI_ACCRUAL_HASH.test(value.source_payload_hash||'')&&AI_ACCRUAL_HASH.test(value.source_line_hash||'')&&AI_INVOICE_CLASSIFICATIONS.has(value.classification)&&boundedText(value.rule_id,128)&&safeAiCapitalizationPolicy(value.policy_evidence)&&boundedText(value.reason,2000)&&typeof value.confidence==='number'&&Number.isFinite(value.confidence)&&value.confidence>=0&&value.confidence<=1&&Array.isArray(value.required_human_fields)&&value.required_human_fields.length<=20&&value.required_human_fields.every(field=>boundedText(field,64))&&safeNoAccountingActions(value.action_flags);
const FORBIDDEN_BODY_KEYS=new Set(['actor','actorId','actor_id','tenantId','tenant_id','entityId','entity_id','requestHash','request_hash']);

export class AccountingApiError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}

const header=(headers,name)=>{
  if(typeof headers?.get==='function')return headers.get(name);
  const key=Object.keys(headers||{}).find(candidate=>candidate.toLowerCase()===name.toLowerCase());
  const value=key?headers[key]:null;return Array.isArray(value)?value[0]:value;
};
const requireUuid=(value,name)=>{if(!UUID.test(value||''))throw new AccountingApiError(400,'INVALID_PATH_PARAMETER',`${name} must be a UUID`);return value;};
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\u0000')===keys.join('\u0000');
const canonicalDate=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const date=new Date(`${value}T00:00:00.000Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;};
const boundedText=(value,max)=>typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const nullableBoundedText=(value,max)=>value===null||boundedText(value,max);
const safeAiAccrualTrace=value=>exactKeys(value,AI_ACCRUAL_TRACE_KEYS)&&UUID.test(value.source_document_id||'')&&UUID.test(value.source_document_line_id||'')&&AI_ACCRUAL_HASH.test(value.source_payload_hash||'')&&AI_ACCRUAL_HASH.test(value.source_line_hash||'')&&UUID.test(value.accounting_period_id||'')&&AI_ACCRUAL_PERIOD.test(value.period_key||'')&&canonicalDate(value.service_period_start)&&canonicalDate(value.service_period_end)&&value.service_period_start<=value.service_period_end&&nullableBoundedText(value.recurring_obligation_id,128)&&nullableBoundedText(value.service_frequency,32)&&nullableBoundedText(value.obligation_status,32)&&/^[A-Z]{3}$/.test(value.currency||'')&&AI_ACCRUAL_MONEY4.test(value.amount||'')?{...value}:null;
const safeAiAccrualCandidate=(value,{entityId,periodId})=>{
  if(!exactKeys(value,AI_ACCRUAL_CANDIDATE_KEYS)||value.status!=='ACCRUAL_CANDIDATE_REVIEW_REQUIRED'||value.rule_id!=='RECURRING_OBLIGATION_MISSING_CURRENT_PERIOD'||value.entity_id!==entityId||value.accounting_period_id!==periodId||!AI_ACCRUAL_PERIOD.test(value.period_key||'')||!nullableBoundedText(value.recurring_obligation_id,128)||!nullableBoundedText(value.service_frequency,32)||!/^[A-Z]{3}$/.test(value.currency||'')||!Array.isArray(value.historical_amounts)||value.historical_amounts.length!==3||value.historical_amounts.some(amount=>!AI_ACCRUAL_MONEY4.test(amount||''))||!Array.isArray(value.prior_source_trace)||value.prior_source_trace.length!==3||!Array.isArray(value.required_human_fields)||value.required_human_fields.join('\u0000')!==AI_ACCRUAL_HUMAN_FIELDS.join('\u0000')||value.can_create_draft!==false||value.can_review!==false||value.can_approve!==false||value.can_post!==false)return null;
  const traces=value.prior_source_trace.map(safeAiAccrualTrace);if(traces.some(trace=>trace===null)||traces.some(trace=>trace.recurring_obligation_id!==value.recurring_obligation_id||trace.currency!==value.currency))return null;
  return {...value,historical_amounts:[...value.historical_amounts],prior_source_trace:traces,required_human_fields:[...value.required_human_fields]};
};
const requireIsoDate=(value,name)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER',`${name} must be an ISO calendar date`);const date=new Date(`${value}T00:00:00.000Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER',`${name} must be an ISO calendar date`);return value;};
const optionalIsoDate=(value,name)=>value==null?null:requireIsoDate(value,name);
const requireBankAccountRef=value=>{if(typeof value!=='string'||!value||value!==value.trim()||value.length>128||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','bankAccountRef must be a canonical trimmed value of 1-128 printable characters');return value;};
const requireAccountCode=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','accountCode must be a canonical account code of 1-64 letters, digits, dot, underscore, or hyphen');return value;};
const optionalAccountCode=value=>value==null||value===''?null:requireAccountCode(value);
const optionalLedgerQuery=value=>{if(value==null||value==='')return null;if(typeof value!=='string'||value!==value.trim()||value.length>160||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','query must be a canonical trimmed value of 1-160 printable characters');return value;};
const optionalReadOffset=value=>{if(value==null||value==='')return 0;if(!/^\d{1,7}$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','offset must be a non-negative integer');return Number(value);};
const requireDimensionType=value=>{if(!['PROPERTY','PROJECT','UNIT','LOT'].includes(value||''))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','dimensionType must be PROPERTY, PROJECT, UNIT, or LOT');return value;};
const requireDimensionRef=value=>{if(typeof value!=='string'||!value||value!==value.trim()||value.length>160||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','dimensionRef must be a canonical trimmed value of 1-160 printable characters');return value;};
const requirePcCode=value=>{if(typeof value!=='string'||value.length<1||value.length>128||value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_PC_CODE','pcCode must be a canonical trimmed value of 1-128 printable characters');return value;};
const requireWbsCompanyCode=value=>{if(typeof value!=='string'||!/^[A-Z0-9][A-Z0-9_:-]{0,63}$/.test(value))throw new AccountingApiError(400,'INVALID_WBS_COMPANY_CODE','companyCode must be a canonical WBS company key');return value;};
const optionalReadLimit=value=>{if(value==null||value==='')return 100;if(!/^[1-9]\d{0,2}$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 200');const limit=Number(value);if(limit>200)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 200');return limit;};
const optionalAdmittedStatementLimit=value=>{if(value==null||value==='')return 50;if(!/^[1-9]\d?$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 50');const limit=Number(value);if(limit>50)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 50');return limit;};
const optionalAmortizationLimit=value=>{if(value==null||value==='')return 50;if(!/^[1-9]\d{0,2}$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 100');const limit=Number(value);if(limit>100)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 100');return limit;};
const controlledTestAiSourceLimit=value=>{if(value==null)return 100;if(!/^[1-9]\d{0,2}$/.test(value))throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 100');const limit=Number(value);if(limit>100)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','limit must be an integer between 1 and 100');return limit;};
const requireExactQuery=(searchParams,allowed)=>{const permitted=new Set(allowed);for(const key of searchParams.keys())if(!permitted.has(key))throw new AccountingApiError(400,'UNEXPECTED_QUERY_PARAMETER',`Unexpected query parameter: ${key}`);for(const key of allowed)if(searchParams.getAll(key).length>1)throw new AccountingApiError(400,'DUPLICATE_QUERY_PARAMETER',`Query parameter must not be repeated: ${key}`);};
const requireIdempotency=headers=>{const value=header(headers,'idempotency-key');if(typeof value!=='string'||value.length<8||value.length>200)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key must be 8-200 characters');return value;};
const requireRevision=headers=>{const raw=header(headers,'if-match');if(raw==null)throw new AccountingApiError(428,'IF_MATCH_REQUIRED','If-Match is required');const value=String(raw).trim();if(value.startsWith('W/'))throw new AccountingApiError(412,'WEAK_IF_MATCH_REJECTED','If-Match must use a strong revision validator');const match=/^"(\d+)"$/.exec(value);if(!match)throw new AccountingApiError(400,'INVALID_IF_MATCH','If-Match must be a quoted non-negative strong revision');const revision=Number(match[1]);if(!Number.isSafeInteger(revision))throw new AccountingApiError(400,'INVALID_IF_MATCH','If-Match must contain a safe non-negative revision');return revision;};
const requireReviewReason=value=>{if(typeof value!=='string'||value!==value.trim()||value.length<8||value.length>2000||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_REASON','reason must be a canonical 8-2000 character review explanation');return value;};
const requireDecimalAmount=(value,name)=>{if(typeof value!=='string'||!/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(value))throw new AccountingApiError(400,'INVALID_AMOUNT',`${name} must be a canonical decimal string with at most four fractional digits`);return value;};
const requireAiConfidence=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1||Math.round(value*10000)!==value*10000)throw new AccountingApiError(400,'INVALID_AI_CONFIDENCE','confidence must be a finite number from 0 to 1 with at most four decimal places');return value;};
const requireSha256=(value,name)=>{if(typeof value!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value))throw new AccountingApiError(400,'INVALID_EVIDENCE_HASH',`${name} must be a canonical sha256 evidence hash`);return value;};
const requireBareSha256=(value,name)=>{if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))throw new AccountingApiError(400,'INVALID_EVIDENCE_HASH',`${name} must be a canonical provider sha256 digest`);return value;};
const requireSourceVersion=(value,name)=>{if(typeof value!=='string'||value!==value.trim()||value.length<1||value.length>128||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_SOURCE_VERSION',`${name} must be a canonical 1-128 character source version`);return value;};
const requireStorageVersion=(value,name)=>{if(typeof value!=='string'||value!==value.trim()||value.length<1||value.length>512||value.startsWith('pending:')||/[\u0000-\u001f\u007f]/.test(value))throw new AccountingApiError(400,'INVALID_STORAGE_VERSION',`${name} must be a canonical finalized storage version of 1-512 printable characters`);return value;};
const requireAttachmentIds=value=>{if(!Array.isArray(value)||value.length<1||value.length>25||value.some(item=>!UUID.test(item||''))||new Set(value).size!==value.length)throw new AccountingApiError(400,'INVALID_ATTACHMENT_IDS','attachmentIds must contain 1-25 unique UUIDs');return value;};
const validateBody=body=>{if(!body||typeof body!=='object'||Array.isArray(body))throw new AccountingApiError(400,'JSON_OBJECT_REQUIRED','Request body must be a JSON object');for(const key of Object.keys(body))if(FORBIDDEN_BODY_KEYS.has(key))throw new AccountingApiError(400,'IDENTITY_FIELD_FORBIDDEN',`${key} must come from authenticated context`);return body;};
const allowOnly=(body,allowed)=>{const unexpected=Object.keys(body).filter(key=>!allowed.includes(key));if(unexpected.length)throw new AccountingApiError(400,'UNEXPECTED_FIELD',`Unexpected request field: ${unexpected[0]}`);return body;};
const requireAiAmortizationMemberTrace=value=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3||!['project_ref','property_ref','allocation_basis'].every(key=>Object.hasOwn(value,key)))throw new AccountingApiError(400,'INVALID_MEMBER_TRACE','memberTrace must contain exactly project_ref, property_ref, and allocation_basis');const ref=(item,name)=>item===null?null:requireDimensionRef(item,name);const projectRef=ref(value.project_ref,'memberTrace.project_ref'),propertyRef=ref(value.property_ref,'memberTrace.property_ref'),basis=value.allocation_basis;if(!['ENTITY_ONLY','SOURCE_DIMENSIONED'].includes(basis)||(basis==='ENTITY_ONLY'&&(projectRef!==null||propertyRef!==null)))throw new AccountingApiError(400,'INVALID_MEMBER_TRACE','memberTrace must be ENTITY_ONLY with null dimensions or SOURCE_DIMENSIONED');return {project_ref:projectRef,property_ref:propertyRef,allocation_basis:basis};};

const isRevisionPrecondition=error=>error?.code==='40001'&&/(revision conflict|version conflict|period changed during transition|staging source changed during journal creation|lease is absent, stale, or owned|AI finding resolution requires an open exact action, finding hash, reason, and revision)/i.test(String(error.message||''));
function statusFor(error){
  if(error instanceof ControlledTestAiWorkflowError)return error.code==='CONTROLLED_TEST_AI_SCOPE_DENIED'?403:/CONFIG_INVALID|UNAVAILABLE/.test(error.code)?503:/RESULT_INVALID|WORKFLOW_INVALID/.test(error.code)?500:422;
  if(error instanceof ControlledTestBankWorkflowError)return error.code==='CONTROLLED_TEST_BANK_SCOPE_DENIED'?403:/CONFIG_INVALID|UNAVAILABLE/.test(error.code)?503:/RESULT_INVALID|SNAPSHOT_INVALID|ITEM_INVALID|ADJUSTMENT_INVALID/.test(error.code)?500:422;
  if(error instanceof ControlledTestBankMatchError)return /CONFIG_INVALID|FIXTURE_UNAVAILABLE/.test(error.code)?503:/RESULT_INVALID|PAYMENT_INVALID|WORKFLOW_INVALID|CANDIDATE_INVALID/.test(error.code)?500:422;
  if(error instanceof WbsTestImportError)return error.code==='WBS_TEST_IMPORT_SCOPE_DENIED'?403:/CONFIG_INVALID/.test(error.code)?503:/RESULT_INVALID|WORKFLOW_INVALID|FINALIZE_INVALID|DRAFT_INVALID/.test(error.code)?500:422;
  if(error instanceof WbsProviderFinal1RetainedEvidenceError)return /SERVICE_IDENTITY_DENIED/.test(error.code)?403:/STORAGE_REQUIRED|PERSISTENCE_REQUIRED|TRUST_REQUIRED|BOUNDARY_REQUIRED/.test(error.code)?503:/RESULT_INVALID/.test(error.code)?500:422;
  if(error instanceof WbsCompanyCatalogControllerError)return /HASH_MISMATCH|SOURCE_CONTROL_INVALID/.test(error.code)?422:400;
  if(error instanceof WbsProviderSignedPayableAdmissionError)return /PERSISTENCE_REQUIRED|TRUST_REQUIRED/.test(error.code)?503:/SERVICE_IDENTITY_DENIED/.test(error.code)?403:error.code==='WBS_PROVIDER_SIGNED_RESULT_INVALID'?500:422;
  if(error instanceof WbsOperatorAttestedPayableError)return error.code==='WBS_OPERATOR_ATTEST_PROVIDER_UNAVAILABLE'?503:error.code==='WBS_OPERATOR_ATTEST_STALE_OBSERVATION'?412:error.code==='WBS_OPERATOR_ATTEST_RESULT_INVALID'?500:422;
  if(error instanceof WbsAdmittedPayableIngestionError)return /PERSISTENCE_REQUIRED|VERIFIER_REQUIRED|PERSISTENCE_FAILED/.test(error.code)?503:error.code==='WBS_PAYABLE_ADMISSION_IDEMPOTENCY_CONFLICT'?409:422;
  if(error instanceof WbsSignedBankAdmissionError)return 422;
  if(error instanceof WbsLivePilotError)return error.code==='WBS_LIVE_PILOT_PROVIDER_UNAVAILABLE'?503:error.code==='WBS_LIVE_PILOT_RESULT_INVALID'?500:400;
  if(error instanceof AiAnalysisExplanationError)return error.code==='AI_GATEWAY_DISABLED'?503:error.code==='AI_ANALYSIS_IN_PROGRESS'?409:error.code==='AI_ANALYSIS_RESPONSE_INVALID'?502:422;
  if(error instanceof WbsReadContractError)return error.status;
  if(error instanceof AccountingApiError)return error.status;
  if(error?.code==='42501')return 403;if(error?.code==='P0002')return 404;
  if(error?.code==='WBS_SNAPSHOT_SIGNATURE_REQUIRED')return 503;
  if(error?.code==='WBS_SNAPSHOT_SIGNATURE_INVALID')return 422;
  if(error?.code==='WBS_BANK_ADMISSION_SIGNATURE_REQUIRED')return 503;
  if(error?.code==='WBS_BANK_ADMISSION_SIGNATURE_INVALID')return 422;
  if(error?.code==='40001')return isRevisionPrecondition(error)?412:503;
  if(error?.code==='23505')return 409;if(error?.code==='55000')return 423;
  if(['22023','23503','23514'].includes(error?.code))return 422;return 500;
}
  const problemFor=error=>{const status=statusFor(error);const code=isRevisionPrecondition(error)?'PRECONDITION_FAILED':error?.code==='55000'&&/Resolved AI finding accountability cannot be reassigned or reopened/.test(String(error.message||''))?'AI_FINDING_ACTION_CLOSED':error?.code==='WBS_SNAPSHOT_SIGNATURE_REQUIRED'?'WBS_SNAPSHOT_SIGNATURE_REQUIRED':error?.code==='WBS_BANK_ADMISSION_SIGNATURE_REQUIRED'?'WBS_BANK_ADMISSION_SIGNATURE_REQUIRED':error?.code==='WBS_READ_SERVICE_UNAVAILABLE'?'WBS_READ_SERVICE_UNAVAILABLE':error?.code==='WBS_PAYABLE_ADMISSION_UNAVAILABLE'?'WBS_PAYABLE_ADMISSION_UNAVAILABLE':error?.code==='WBS_FINAL1_ADMISSION_UNAVAILABLE'?'WBS_FINAL1_ADMISSION_UNAVAILABLE':error?.code==='WBS_OPERATOR_ATTEST_UNAVAILABLE'?'WBS_OPERATOR_ATTEST_UNAVAILABLE':error?.code==='AI_FINDING_READ_UNAVAILABLE'?'AI_FINDING_READ_UNAVAILABLE':error?.code==='AI_FINDING_ACTION_UNAVAILABLE'?'AI_FINDING_ACTION_UNAVAILABLE':error?.code==='AI_FINDING_ACTION_RESOLUTION_UNAVAILABLE'?'AI_FINDING_ACTION_RESOLUTION_UNAVAILABLE':error?.code==='AI_FINDING_ASSIGNMENT_CANDIDATE_READ_UNAVAILABLE'?'AI_FINDING_ASSIGNMENT_CANDIDATE_READ_UNAVAILABLE':error?.code==='AI_FINDING_ACTION_READ_UNAVAILABLE'?'AI_FINDING_ACTION_READ_UNAVAILABLE':error?.code==='AI_PREPAID_COVERAGE_FINDING_READ_UNAVAILABLE'?'AI_PREPAID_COVERAGE_FINDING_READ_UNAVAILABLE':error?.code==='AI_DUPLICATE_PAYABLE_FINDING_READ_UNAVAILABLE'?'AI_DUPLICATE_PAYABLE_FINDING_READ_UNAVAILABLE':error?.code==='AI_UNMATCHED_BANK_PAYMENT_FINDING_READ_UNAVAILABLE'?'AI_UNMATCHED_BANK_PAYMENT_FINDING_READ_UNAVAILABLE':error?.code==='AI_COST_DIMENSION_FINDING_READ_UNAVAILABLE'?'AI_COST_DIMENSION_FINDING_READ_UNAVAILABLE':error?.code==='AI_LOAN_REFERENCE_FINDING_READ_UNAVAILABLE'?'AI_LOAN_REFERENCE_FINDING_READ_UNAVAILABLE':error?.code==='AI_ACCOUNTING_ANALYSIS_SUMMARY_UNAVAILABLE'?'AI_ACCOUNTING_ANALYSIS_SUMMARY_UNAVAILABLE':error?.code==='AI_ANALYSIS_EXPLANATION_UNAVAILABLE'?'AI_ANALYSIS_EXPLANATION_UNAVAILABLE':error?.code==='AI_AMORTIZATION_COVERAGE_EVIDENCE_UNAVAILABLE'?'AI_AMORTIZATION_COVERAGE_EVIDENCE_UNAVAILABLE':error?.code==='AI_AMORTIZATION_COVERAGE_EVIDENCE_READ_UNAVAILABLE'?'AI_AMORTIZATION_COVERAGE_EVIDENCE_READ_UNAVAILABLE':error?.code==='AI_AMORTIZATION_PROPOSAL_UNAVAILABLE'?'AI_AMORTIZATION_PROPOSAL_UNAVAILABLE':error?.code==='AI_AMORTIZATION_DRAFT_UNAVAILABLE'?'AI_AMORTIZATION_DRAFT_UNAVAILABLE':error instanceof WbsCompanyCatalogControllerError?error.code:error instanceof WbsProviderFinal1RetainedEvidenceError?error.code:error instanceof WbsProviderSignedPayableAdmissionError?error.code:error instanceof WbsOperatorAttestedPayableError?error.code:error instanceof WbsSignedBankAdmissionError?error.code:error instanceof WbsAdmittedPayableIngestionError?error.code:error instanceof WbsLivePilotError?error.code:error instanceof AiAnalysisExplanationError?error.code:error instanceof WbsReadContractError?error.code:status===503?'SERIALIZATION_RETRY_EXHAUSTED':error.code||'INTERNAL_ERROR';const message=status>=500?'Internal server error':status===403?'Forbidden':error.message;const headers={'content-type':'application/problem+json','cache-control':'no-store'};if(status===503)headers['retry-after']='1';return {status,headers,body:{ok:false,code,message}};};

export function createAccountingApi({authenticate,kernelFactory,attachmentServiceFactory,wbsReadServiceFactory,wbsLivePilotServiceFactory,wbsTestImportServiceFactory,controlledTestAiWorkflowServiceFactory,wbsAdmittedPayableServiceFactory,wbsProviderSignedPayableServiceFactory,wbsProviderFinal1RetainedEvidenceServiceFactory,wbsOperatorAttestedPayableServiceFactory,aiAnalysisExplanationServiceFactory,aiAccrualCandidateAnalysisServiceFactory,aiInvoiceAccountingClassificationServiceFactory,stage1SelfGrantServiceFactory,stage1SelfWbsReadUpgradeServiceFactory,stage1SelfWbsOperatorUpgradeServiceFactory,stage1SelfControlledTestWorkflowUpgradeServiceFactory}={}){
  if(typeof authenticate!=='function'||typeof kernelFactory!=='function')throw new Error('Accounting API requires authenticate and kernelFactory');
  return async function dispatch({method,url,headers={},body=null}){
    try{
      const principal=await authenticate({method,url,headers});
      if(!principal||principal.trusted!==true||!UUID.test(principal.tenantId||'')||!principal.actorId)throw new AccountingApiError(401,'AUTHENTICATION_REQUIRED','Authenticated principal is required');
      const parsedUrl=new URL(url,'http://refs.local');const pathname=parsedUrl.pathname;const parts=pathname.split('/').filter(Boolean);
      if(parts[0]!=='api'||parts[1]!=='v1'||parts[2]!=='entities')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      const entityId=requireUuid(parts[3],'entityId');const payload=method==='GET'&&body==null?{}:validateBody(body);
      let result;
      if(method==='POST'&&parts.length===7&&parts[4]==='access'&&parts[5]==='self-service-read-grant'&&parts[6]==='activate'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(Object.keys(payload).length)throw new AccountingApiError(400,'UNEXPECTED_FIELD','Self-service reader activation accepts no request fields');
        if(typeof stage1SelfGrantServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const service=await stage1SelfGrantServiceFactory(principal);
        if(!service||typeof service.grant!=='function')throw new Error('Self-service reader activation is unavailable');
        result=await service.grant({entityId,idempotencyKey:requireIdempotency(headers)});
        return {status:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:{activated:true,idempotent:result.idempotent===true,permission_count:result.permissionCount}}};
      }
      if(method==='POST'&&parts.length===7&&parts[4]==='access'&&parts[5]==='self-service-wbs-read-grant'&&parts[6]==='upgrade'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(Object.keys(payload).length)throw new AccountingApiError(400,'UNEXPECTED_FIELD','Self-service WBS reader upgrade accepts no request fields');
        if(typeof stage1SelfWbsReadUpgradeServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const service=await stage1SelfWbsReadUpgradeServiceFactory(principal);
        if(!service||typeof service.upgrade!=='function')throw new Error('Self-service WBS reader upgrade is unavailable');
        result=await service.upgrade({entityId,idempotencyKey:requireIdempotency(headers)});
        return {status:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:{upgraded:true,idempotent:result.idempotent===true,permission_count:result.permissionCount}}};
      }
      if(method==='POST'&&parts.length===7&&parts[4]==='access'&&parts[5]==='self-service-wbs-operator-grant'&&parts[6]==='upgrade'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(Object.keys(payload).length)throw new AccountingApiError(400,'UNEXPECTED_FIELD','Self-service WBS operator upgrade accepts no request fields');
        if(typeof stage1SelfWbsOperatorUpgradeServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const service=await stage1SelfWbsOperatorUpgradeServiceFactory(principal);
        if(!service||typeof service.upgrade!=='function')throw new Error('Self-service WBS operator upgrade is unavailable');
        result=await service.upgrade({entityId,idempotencyKey:requireIdempotency(headers)});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:{upgraded:true,idempotent:result.idempotent===true,permission_count:result.permissionCount}}};
      }
      if(method==='POST'&&parts.length===7&&parts[4]==='access'&&parts[5]==='self-service-controlled-test-workflow-grant'&&parts[6]==='upgrade'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(Object.keys(payload).length)throw new AccountingApiError(400,'UNEXPECTED_FIELD','Controlled test workflow upgrade accepts no request fields');
        if(typeof stage1SelfControlledTestWorkflowUpgradeServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const service=await stage1SelfControlledTestWorkflowUpgradeServiceFactory(principal);
        if(!service||typeof service.upgrade!=='function')throw new Error('Controlled test workflow upgrade is unavailable');
        result=await service.upgrade({entityId,idempotencyKey:requireIdempotency(headers)});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:{upgraded:true,idempotent:result.idempotent===true,permission_count:result.permissionCount,test_only:true}}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='wbs'&&parts[5]==='live-pilot'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        if(typeof wbsLivePilotServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const selection=parseWbsLivePilotSelection(parsedUrl.searchParams),service=await wbsLivePilotServiceFactory(principal);
        if(!service||typeof service.readObservation!=='function')throw new WbsLivePilotError('WBS_LIVE_PILOT_PROVIDER_UNAVAILABLE','WBS live pilot service is unavailable.');
        const scopedSelection={tenantId:principal.tenantId,entityId,tool:selection.tool,limit:selection.limit};
        if(selection.company_code)scopedSelection.company_code=selection.company_code;
        if(selection.date_from){scopedSelection.date_from=selection.date_from;scopedSelection.date_to=selection.date_to;}
        result=await service.readObservation(scopedSelection);
        assertWbsLivePilotResult(result,{entityId,tool:selection.tool,limit:selection.limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===7&&parts[4]==='wbs'&&parts[5]==='test-import'&&parts[6]==='payables'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['periodId','companyCode','dateFrom','dateTo','limit']);
        if(typeof wbsTestImportServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        if(!Number.isSafeInteger(payload.limit)||payload.limit<1||payload.limit>10)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 10');
        const service=await wbsTestImportServiceFactory(principal);
        if(!service||typeof service.importPayables!=='function')throw new WbsTestImportError('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import service is unavailable.');
        result=await service.importPayables({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),companyCode:requireWbsCompanyCode(payload.companyCode),dateFrom:requireIsoDate(payload.dateFrom,'dateFrom'),dateTo:requireIsoDate(payload.dateTo,'dateTo'),limit:payload.limit,idempotencyKey:requireIdempotency(headers)});
        assertWbsTestImportResult(result);
        return {status:result.imported_count===0?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===7&&parts[4]==='wbs'&&parts[5]==='test-import'&&parts[6]==='bank-transactions'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['periodId','companyCode','dateFrom','dateTo','limit']);
        if(typeof wbsTestImportServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        if(!Number.isSafeInteger(payload.limit)||payload.limit<1||payload.limit>10)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 10');
        const service=await wbsTestImportServiceFactory(principal);
        if(!service||typeof service.importBankTransactions!=='function')throw new WbsTestImportError('WBS_TEST_IMPORT_CONFIG_INVALID','Controlled test Bank service is unavailable.');
        result=await service.importBankTransactions({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),companyCode:requireWbsCompanyCode(payload.companyCode),dateFrom:requireIsoDate(payload.dateFrom,'dateFrom'),dateTo:requireIsoDate(payload.dateTo,'dateTo'),limit:payload.limit,idempotencyKey:requireIdempotency(headers)});
        assertWbsControlledTestBankResult(result);
        return {status:result.idempotent?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===7&&parts[4]==='wbs'&&parts[5]==='test-import'&&parts[6]==='range'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['companyCode','dateFrom','dateTo','pageSize','maxPages']);
        if(typeof wbsTestImportServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        if(payload.pageSize!==10)throw new AccountingApiError(400,'INVALID_LIMIT','pageSize must equal the frozen ten-row Provider page size');
        if(!Number.isSafeInteger(payload.maxPages)||payload.maxPages<1||payload.maxPages>1000)throw new AccountingApiError(400,'INVALID_LIMIT','maxPages must be an integer from 1 to 1000');
        const service=await wbsTestImportServiceFactory(principal);
        if(!service||typeof service.importRange!=='function')throw new WbsTestImportError('WBS_TEST_IMPORT_CONFIG_INVALID','Paged test-import service is unavailable.');
        result=await service.importRange({tenantId:principal.tenantId,entityId,companyCode:requireWbsCompanyCode(payload.companyCode),dateFrom:requireIsoDate(payload.dateFrom,'dateFrom'),dateTo:requireIsoDate(payload.dateTo,'dateTo'),pageSize:payload.pageSize,maxPages:payload.maxPages,idempotencyKey:requireIdempotency(headers)});
        assertWbsTestRangeImportResult(result);
        return {status:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='test-import'&&parts[6]==='bank-workflow'&&parts[7]==='run'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['periodId','reconciliationId','scopes','reason','maxItems']);
        if(typeof wbsTestImportServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const service=await wbsTestImportServiceFactory(principal);
        const range=Array.isArray(payload.scopes);
        if(range&&(payload.periodId!==undefined||payload.reconciliationId!==undefined)||!range&&(payload.periodId===undefined||payload.reconciliationId===undefined))throw new AccountingApiError(400,'INVALID_BANK_WORKFLOW_SCOPE','Provide either one period/reconciliation pair or one to six monthly scopes');
        if(!service||typeof service[range?'runRange':'run']!=='function')throw new ControlledTestBankWorkflowError('CONTROLLED_TEST_BANK_CONFIG_INVALID','Controlled test Bank workflow service is unavailable.');
        const common={tenantId:principal.tenantId,entityId,reason:requireReviewReason(payload.reason),idempotencyKey:requireIdempotency(headers)};
        if(range){
          if(payload.maxItems!==undefined)throw new AccountingApiError(400,'INVALID_BANK_WORKFLOW_SCOPE','maxItems is supported only by the single-month resumable workflow');
          if(payload.scopes.length<1||payload.scopes.length>6)throw new AccountingApiError(400,'INVALID_BANK_WORKFLOW_SCOPE','scopes must contain one to six monthly period/reconciliation pairs');
          const scopes=payload.scopes.map((item,index)=>{allowOnly(item,['periodId','reconciliationId']);return {periodId:requireUuid(item.periodId,`scopes[${index}].periodId`),reconciliationId:requireUuid(item.reconciliationId,`scopes[${index}].reconciliationId`)};});
          result=await service.runRange({...common,scopes});assertControlledTestBankRangeWorkflowResult(result);
        }else{
          const maxItems=payload.maxItems===undefined?25:payload.maxItems;
          if(!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>100)throw new AccountingApiError(400,'INVALID_LIMIT','maxItems must be an integer from 1 to 100');
          result=await service.run({...common,periodId:requireUuid(payload.periodId,'periodId'),reconciliationId:requireUuid(payload.reconciliationId,'reconciliationId'),maxItems});
          if(result?.status==='CONTROLLED_TEST_BANK_WORKFLOW_PARTIAL')assertControlledTestBankWorkflowPartialResult(result);else assertControlledTestBankWorkflowResult(result);
        }
        return {status:result.status==='CONTROLLED_TEST_BANK_WORKFLOW_PARTIAL'||result.idempotent?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='test-import'&&parts[6]==='bank-match'&&parts[7]==='run'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['reason']);
        if(typeof wbsTestImportServiceFactory!=='function')throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        const service=await wbsTestImportServiceFactory(principal);
        if(!service||typeof service.runBankMatch!=='function')throw new ControlledTestBankMatchError('CONTROLLED_TEST_BANK_MATCH_CONFIG_INVALID','Controlled test Bank Match service is unavailable.');
        result=assertControlledTestBankMatchResult(await service.runBankMatch({tenantId:principal.tenantId,entityId,reason:requireReviewReason(payload.reason),idempotencyKey:requireIdempotency(headers)}));
        return {status:result.idempotent?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='wbs'&&parts[5]==='property-rent-pickup'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Property Rent pickup reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','limit']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listWbsPropertyRentPickup!=='function')throw new AccountingApiError(503,'WBS_PROPERTY_RENT_READ_UNAVAILABLE','Property Rent pickup read is unavailable');
        result=await kernel.listWbsPropertyRentPickup({tenantId:principal.tenantId,entityId,periodId:requireUuid(parsedUrl.searchParams.get('periodId'),'periodId'),limit:optionalAdmittedStatementLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='insurance'&&parts[6]==='pc-mapping-proposals'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null||body!==null)throw new AccountingApiError(400,'READ_REQUEST_INVALID','Insurance PC mapping proposal reads accept no body or command headers');
        requireExactQuery(parsedUrl.searchParams,[]);const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.getWbsInsurancePcMappingProposal!=='function')throw new AccountingApiError(503,'WBS_INSURANCE_PC_MAPPING_READ_UNAVAILABLE','Insurance PC mapping proposal read is unavailable');
        result=await kernel.getWbsInsurancePcMappingProposal({tenantId:principal.tenantId,entityId,proposalId:requireUuid(parts[7],'proposalId')});assertInsurancePcMappingDto(result);
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='insurance'&&parts[6]==='pc-company-mappings'&&parts[7]==='trace'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null||body!==null)throw new AccountingApiError(400,'READ_REQUEST_INVALID','Insurance PC mapping trace reads accept no body or command headers');
        requireExactQuery(parsedUrl.searchParams,['pcCode','accountingDate']);const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.getWbsInsurancePcMappingTrace!=='function')throw new AccountingApiError(503,'WBS_INSURANCE_PC_MAPPING_TRACE_UNAVAILABLE','Insurance PC mapping trace is unavailable');
        result=await kernel.getWbsInsurancePcMappingTrace({tenantId:principal.tenantId,entityId,pcCode:requirePcCode(parsedUrl.searchParams.get('pcCode')),accountingDate:requireIsoDate(parsedUrl.searchParams.get('accountingDate'),'accountingDate')});assertInsurancePcMappingDto(result,{approved:true,trace:true});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='provider-signed'&&parts[6]==='final1'&&parts[7]==='orphans'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null||body!==null)throw new AccountingApiError(400,'READ_REQUEST_INVALID','Orphan lifecycle reads accept no body or command headers');
        requireExactQuery(parsedUrl.searchParams,['admissionId']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.readWbsProviderFinal1OrphanLifecycle!=='function')throw new AccountingApiError(503,'WBS_FINAL1_ORPHAN_READ_UNAVAILABLE','Final-1 orphan lifecycle read is unavailable');
        result=await kernel.readWbsProviderFinal1OrphanLifecycle({tenantId:principal.tenantId,entityId,admissionId:parsedUrl.searchParams.has('admissionId')?requireUuid(parsedUrl.searchParams.get('admissionId'),'admissionId'):null});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='property-rent-pickup'&&parts[7]==='reviews'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['periodId','expectedEvidenceHash','reason']);
        const expectedRevision=requireRevision(headers);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.reviewWbsPropertyRent!=='function')throw new AccountingApiError(503,'WBS_PROPERTY_RENT_REVIEW_UNAVAILABLE','Property Rent review is unavailable');
        result=await kernel.reviewWbsPropertyRent({tenantId:principal.tenantId,entityId,admissionId:requireUuid(parts[6],'admissionId'),periodId:requireUuid(payload.periodId,'periodId'),expectedRevision,expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),reason:requireReviewReason(payload.reason),idempotencyKey:requireIdempotency(headers)});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===9&&parts[4]==='wbs'&&parts[5]==='property-rent-pickup'&&parts[6]==='reviews'&&parts[8]==='drafts'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['expectedEvidenceHash','reason']);
        const expectedRevision=requireRevision(headers);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.createWbsPropertyRentDraft!=='function')throw new AccountingApiError(503,'WBS_PROPERTY_RENT_DRAFT_UNAVAILABLE','Property Rent Draft creation is unavailable');
        result=await kernel.createWbsPropertyRentDraft({tenantId:principal.tenantId,entityId,reviewEvidenceId:requireUuid(parts[7],'reviewEvidenceId'),expectedRevision,expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),reason:requireReviewReason(payload.reason),idempotencyKey:requireIdempotency(headers)});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='prepaid'&&parts[5]==='amortization'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Insurance amortization reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','limit']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listInsurancePrepaidAmortization!=='function')throw new AccountingApiError(503,'INSURANCE_AMORTIZATION_READ_UNAVAILABLE','Insurance prepaid amortization evidence read is unavailable');
        result=await kernel.listInsurancePrepaidAmortization({tenantId:principal.tenantId,entityId,periodId:requireUuid(parsedUrl.searchParams.get('periodId'),'periodId'),limit:optionalAmortizationLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===7&&parts[4]==='prepaid'&&parts[5]==='amortization'&&parts[6]==='reviews'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['admissionId','scheduleId','scheduleLineId','periodId','settingSnapshotId','mappingSnapshotId','capitalizationJournalEntryId','capitalizationLedgerLineId','expectedSourceHash','expectedProposalHash','expectedCoverageHash','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.reviewInsurancePrepaidAmortization!=='function')throw new AccountingApiError(503,'INSURANCE_AMORTIZATION_REVIEW_UNAVAILABLE','Insurance prepaid amortization review is unavailable');
        result=await kernel.reviewInsurancePrepaidAmortization({tenantId:principal.tenantId,entityId,admissionId:requireUuid(payload.admissionId,'admissionId'),scheduleId:requireUuid(payload.scheduleId,'scheduleId'),scheduleLineId:requireUuid(payload.scheduleLineId,'scheduleLineId'),periodId:requireUuid(payload.periodId,'periodId'),settingSnapshotId:requireUuid(payload.settingSnapshotId,'settingSnapshotId'),mappingSnapshotId:requireUuid(payload.mappingSnapshotId,'mappingSnapshotId'),capitalizationJournalEntryId:requireUuid(payload.capitalizationJournalEntryId,'capitalizationJournalEntryId'),capitalizationLedgerLineId:requireUuid(payload.capitalizationLedgerLineId,'capitalizationLedgerLineId'),expectedSourceVersion:requireRevision(headers),expectedSourceHash:requireSha256(payload.expectedSourceHash,'expectedSourceHash'),expectedProposalHash:requireSha256(payload.expectedProposalHash,'expectedProposalHash'),expectedCoverageHash:requireSha256(payload.expectedCoverageHash,'expectedCoverageHash'),reason:requireReviewReason(payload.reason),idempotencyKey:requireIdempotency(headers)});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===9&&parts[4]==='prepaid'&&parts[5]==='amortization'&&parts[6]==='reviews'&&parts[8]==='drafts'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['expectedEvidenceHash','reason']);const expectedRevision=requireRevision(headers);if(expectedRevision!==0)throw new AccountingApiError(412,'REVIEW_EVIDENCE_VERSION_CHANGED','Insurance amortization review evidence has immutable revision zero');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.createInsurancePrepaidAmortizationDraft!=='function')throw new AccountingApiError(503,'INSURANCE_AMORTIZATION_DRAFT_UNAVAILABLE','Insurance prepaid amortization Draft creation is unavailable');
        result=await kernel.createInsurancePrepaidAmortizationDraft({tenantId:principal.tenantId,entityId,reviewEvidenceId:requireUuid(parts[7],'reviewEvidenceId'),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),reason:requireReviewReason(payload.reason),idempotencyKey:requireIdempotency(headers)});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[7]==='reviews'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','WBS Payable evidence reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listWbsPayableReviewEvidence!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_EVIDENCE_READ_UNAVAILABLE','WBS Payable evidence read is unavailable');
        result=await kernel.listWbsPayableReviewEvidence({tenantId:principal.tenantId,entityId,limit:optionalAdmittedStatementLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[7]==='review-candidates'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','WBS Payable review-candidate reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listWbsPayableReviewCandidates!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_REVIEW_CANDIDATE_READ_UNAVAILABLE','WBS Payable review-candidate read is unavailable');
        result=await kernel.listWbsPayableReviewCandidates({tenantId:principal.tenantId,entityId,limit:optionalAdmittedStatementLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===9&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[7]==='review-candidates'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','WBS Payable review-candidate reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.getWbsPayableReviewCandidate!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_REVIEW_CANDIDATE_READ_UNAVAILABLE','WBS Payable review-candidate read is unavailable');
        result=await kernel.getWbsPayableReviewCandidate({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[8],'wbsInboundRowId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result[0]}};
      }
      if(method==='GET'&&parts.length===9&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[7]==='reviews'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','WBS Payable evidence reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.getWbsPayableReviewEvidence!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_EVIDENCE_READ_UNAVAILABLE','WBS Payable evidence read is unavailable');
        result=await kernel.getWbsPayableReviewEvidence({tenantId:principal.tenantId,entityId,reviewEvidenceId:requireUuid(parts[8],'reviewEvidenceId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result[0]}};
      }
      if(method==='GET'&&parts.length===6&&((parts[4]==='ap'&&parts[5]==='bills')||(parts[4]==='ar'&&parts[5]==='invoices'))){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(Object.keys(payload).length)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listBusinessDocuments({tenantId:principal.tenantId,entityId,documentKind:parts[4]==='ap'?'AP_BILL':'AR_INVOICE'});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===5&&parts[4]==='journal-entries'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(Object.keys(payload).length)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listJournalEntries({tenantId:principal.tenantId,entityId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='journal-workflow'&&parts[5]==='capabilities'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.getJournalWorkflowCapabilities!=='function')throw new AccountingApiError(503,'JOURNAL_WORKFLOW_CAPABILITIES_UNAVAILABLE','Journal workflow capabilities are unavailable');
        result=await kernel.getJournalWorkflowCapabilities({tenantId:principal.tenantId,entityId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='journal-entries'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const journalEntryId=requireUuid(parts[5],'journalEntryId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        try{result=await kernel.getJournalEntryDetail({tenantId:principal.tenantId,entityId,periodId,journalEntryId});}
        catch(error){if(error?.code==='P0002')throw new AccountingApiError(404,'JOURNAL_ENTRY_NOT_FOUND','Journal entry was not found');throw error;}
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===5&&parts[4]==='source-documents'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listSourceDocuments({tenantId:principal.tenantId,entityId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='source-documents'&&parts[5]==='controlled-test-ai-eligible'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','limit']);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listControlledTestAiSources({tenantId:principal.tenantId,entityId,periodId:requireUuid(parsedUrl.searchParams.get('periodId'),'periodId'),limit:controlledTestAiSourceLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='source-documents'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getSourceDocumentDetail({tenantId:principal.tenantId,entityId,sourceDocumentId:requireUuid(parts[5],'sourceDocumentId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===9&&parts[4]==='wbs'&&parts[5]==='provider-signed'&&parts[6]==='evidence'&&parts[7]==='source-documents'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Provider-signed evidence reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.getWbsProviderSignedSourceEvidence!=='function')throw new AccountingApiError(503,'WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_UNAVAILABLE','Provider-signed source evidence read is unavailable');
        try{result=await kernel.getWbsProviderSignedSourceEvidence({tenantId:principal.tenantId,entityId,sourceDocumentId:requireUuid(parts[8],'sourceDocumentId')});}
        catch(error){if(error?.code==='WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_NOT_AVAILABLE')throw new AccountingApiError(404,'WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_NOT_AVAILABLE','Exact formally admitted provider-signed source evidence is not available');throw error;}
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='general-ledger'&&parts[5]==='chart-of-accounts'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listChartOfAccounts({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===5&&parts[4]==='scope'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.readAuthoritativeScope({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='access'&&parts[5]==='self'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.readCurrentActorAccess({tenantId:principal.tenantId,entityId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='general-ledger'&&parts[5]==='account-register'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','accountCode']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const accountCode=requireAccountCode(parsedUrl.searchParams.get('accountCode'));
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listAccountRegister({tenantId:principal.tenantId,entityId,periodId,accountCode});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='general-ledger'&&parts[5]==='entries'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','accountCode','query','limit','offset']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listGeneralLedger({tenantId:principal.tenantId,entityId,periodId,accountCode:optionalAccountCode(parsedUrl.searchParams.get('accountCode')),query:optionalLedgerQuery(parsedUrl.searchParams.get('query')),limit:optionalReadLimit(parsedUrl.searchParams.get('limit')),offset:optionalReadOffset(parsedUrl.searchParams.get('offset'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='bank'&&parts[5]==='transactions'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['bankAccountRef','from','through','limit','offset']);
        const bankAccountRef=requireBankAccountRef(parsedUrl.searchParams.get('bankAccountRef'));
        const fromDate=optionalIsoDate(parsedUrl.searchParams.get('from'),'from');
        const throughDate=optionalIsoDate(parsedUrl.searchParams.get('through'),'through');
        if(fromDate&&throughDate&&fromDate>throughDate)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','from must not be later than through');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listBankTransactions({tenantId:principal.tenantId,entityId,bankAccountRef,fromDate,throughDate,limit:optionalReadLimit(parsedUrl.searchParams.get('limit')),offset:optionalReadOffset(parsedUrl.searchParams.get('offset'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='bank'&&parts[5]==='transactions'&&parts[7]==='match-candidates'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listBankMatchCandidates({tenantId:principal.tenantId,entityId,bankSourceId:requireUuid(parts[6],'bankSourceId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='bank'&&parts[5]==='reconciliation'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['bankAccountRef','statementEndingDate']);
        const bankAccountRef=requireBankAccountRef(parsedUrl.searchParams.get('bankAccountRef'));
        const statementEndingDate=requireIsoDate(parsedUrl.searchParams.get('statementEndingDate'),'statementEndingDate');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getReconciliationSummary({tenantId:principal.tenantId,entityId,bankAccountRef,statementEndingDate});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[6]==='scopes'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listReconciliationScopes({tenantId:principal.tenantId,entityId,limit:optionalReadLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[6]==='admitted-statements'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['bankAccountRef','limit']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listAdmittedWbsBankStatementReceipts!=='function')throw new AccountingApiError(503,'ADMITTED_STATEMENT_READ_UNAVAILABLE','Admitted statement read service is unavailable');
        result=await kernel.listAdmittedWbsBankStatementReceipts({tenantId:principal.tenantId,entityId,bankAccountRef:requireBankAccountRef(parsedUrl.searchParams.get('bankAccountRef')),limit:optionalAdmittedStatementLimit(parsedUrl.searchParams.get('limit'))});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[6]==='admitted-statements'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.getAdmittedWbsBankStatementReceipt!=='function')throw new AccountingApiError(503,'ADMITTED_STATEMENT_READ_UNAVAILABLE','Admitted statement read service is unavailable');
        result=await kernel.getAdmittedWbsBankStatementReceipt({tenantId:principal.tenantId,entityId,statementReceiptId:requireUuid(parts[7],'statementReceiptId')});
        if(!Array.isArray(result)||result.length!==1)throw new AccountingApiError(404,'ADMITTED_STATEMENT_NOT_FOUND','Admitted statement receipt was not found in this entity');
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result[0]}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='worksheet'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listReconciliationWorksheet({tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='signed-snapshot'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getSignedReconciliationSnapshot({tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId')});
        if(!Array.isArray(result)||result.length!==1)throw new AccountingApiError(404,'SIGNED_RECONCILIATION_SNAPSHOT_NOT_FOUND','Signed reconciliation snapshot was not found in this entity');
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result[0]}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='financial-statements'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getFinancialStatements({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='financial-statement-snapshot'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getFinancialStatementSnapshot({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='consolidation'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','groupRef']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const groupRef=requireDimensionRef(parsedUrl.searchParams.get('groupRef'));
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getConsolidation({tenantId:principal.tenantId,entityId,periodId,groupRef});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='financial-statement-period-comparison'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['currentPeriodId','priorPeriodId']);
        const currentPeriodId=requireUuid(parsedUrl.searchParams.get('currentPeriodId'),'currentPeriodId');
        const priorPeriodId=requireUuid(parsedUrl.searchParams.get('priorPeriodId'),'priorPeriodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getFinancialStatementPeriodComparison({tenantId:principal.tenantId,entityId,currentPeriodId,priorPeriodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='dimension-profitability'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','dimensionType','dimensionRef']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const dimensionType=requireDimensionType(parsedUrl.searchParams.get('dimensionType'));
        const dimensionRef=requireDimensionRef(parsedUrl.searchParams.get('dimensionRef'));
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getDimensionProfitability({tenantId:principal.tenantId,entityId,periodId,dimensionType,dimensionRef});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='cash-flow-classification'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getCashFlowClassification({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='cwip-rollforward'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getCwipRollforward({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='construction-loan-rollforward'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getConstructionLoanRollforward({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='prepaid-rollforward'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getPrepaidRollforward({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='intercompany-reconciliation'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','counterpartyEntityId','counterpartyPeriodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const counterpartyEntityId=requireUuid(parsedUrl.searchParams.get('counterpartyEntityId'),'counterpartyEntityId');
        const counterpartyPeriodId=requireUuid(parsedUrl.searchParams.get('counterpartyPeriodId'),'counterpartyPeriodId');
        if(counterpartyEntityId===entityId)throw new AccountingApiError(400,'INVALID_QUERY_PARAMETER','counterpartyEntityId must differ from entityId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getIntercompanyReconciliation({tenantId:principal.tenantId,entityId,periodId,counterpartyEntityId,counterpartyPeriodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='reports'&&parts[5]==='budget-vs-actual'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);
        const periodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.getBudgetVsActual({tenantId:principal.tenantId,entityId,periodId});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='wbs'&&parts[5]==='auto-reconciliation'&&parts[6]==='review-candidates'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        if(typeof wbsReadServiceFactory!=='function')throw new AccountingApiError(503,'WBS_READ_SERVICE_UNAVAILABLE','WBS read service is unavailable');
        const selection=parseWbsAutoRecReviewSelection(parsedUrl.searchParams);
        const service=await wbsReadServiceFactory(principal);
        if(!service||typeof service.readAutoRecReview!=='function')throw new AccountingApiError(503,'WBS_READ_SERVICE_UNAVAILABLE','WBS read service is unavailable');
        result=assertWbsReadOnlyResult(await service.readAutoRecReview({tenantId:principal.tenantId,entityId,companyKey:selection.companyKey,sourceRecordIds:selection.sourceRecordIds}));
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='wbs'&&parts[5]==='company-catalogs'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Company catalog reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit','offset']);const limit=optionalReadLimit(parsedUrl.searchParams.get('limit')),offset=optionalReadOffset(parsedUrl.searchParams.get('offset'));
        if(limit>100||offset>100000)throw new AccountingApiError(400,'INVALID_PAGINATION','Company catalog pagination is limited to 100 rows and offset 100000');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listWbsCompanyCatalogCandidates!=='function')throw new AccountingApiError(503,'WBS_COMPANY_CATALOG_READ_UNAVAILABLE','Company catalog candidates are unavailable');
        result=await kernel.listWbsCompanyCatalogCandidates({tenantId:principal.tenantId,entityId,limit,offset});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='company-catalogs'&&parts[7]==='companies'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Company catalog row reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit','offset']);const limit=optionalReadLimit(parsedUrl.searchParams.get('limit')),offset=optionalReadOffset(parsedUrl.searchParams.get('offset'));
        if(limit>50||offset>100000)throw new AccountingApiError(400,'INVALID_PAGINATION','Company catalog row pagination is limited to 50 rows and offset 100000');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listWbsCompanyCatalogRows!=='function')throw new AccountingApiError(503,'WBS_COMPANY_CATALOG_READ_UNAVAILABLE','Company catalog rows are unavailable');
        result=await kernel.listWbsCompanyCatalogRows({tenantId:principal.tenantId,entityId,candidateId:requireUuid(parts[6],'candidateId'),limit,offset});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='auto-reconciliation'&&parts[6]==='match-reviews'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AutoRec Bank Match review reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.getWbsAutoRecBankMatchReview!=='function')throw new AccountingApiError(503,'WBS_AUTOREC_MATCH_REVIEW_READ_UNAVAILABLE','AutoRec Bank Match review evidence is unavailable');
        result=await kernel.getWbsAutoRecBankMatchReview({tenantId:principal.tenantId,entityId,reviewId:requireUuid(parts[7],'reviewId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===9&&parts[4]==='wbs'&&parts[5]==='auto-reconciliation'&&parts[6]==='match-reviews'&&parts[8]==='g11-evidence'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','G11 evidence reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.getWbsAutoRecG11Evidence!=='function')throw new AccountingApiError(503,'WBS_AUTOREC_G11_EVIDENCE_UNAVAILABLE','AutoRec G11 evidence is unavailable');
        result=await kernel.getWbsAutoRecG11Evidence({tenantId:principal.tenantId,entityId,reviewId:requireUuid(parts[7],'reviewId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='wbs'&&parts[5]==='operator-attested'&&parts[6]==='payables'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Operator-attested evidence reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 50');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listWbsOperatorPayableAttestations!=='function')throw new AccountingApiError(503,'WBS_OPERATOR_ATTEST_UNAVAILABLE','Operator-attested WBS Payable evidence is unavailable');
        result=await kernel.listWbsOperatorPayableAttestations({tenantId:principal.tenantId,entityId,limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===9&&parts[4]==='wbs'&&parts[5]==='operator-attested'&&parts[6]==='payables'&&parts[8]==='rows'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Operator-attested exception-row reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?10:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 10');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listWbsOperatorPayableExceptionRows!=='function')throw new AccountingApiError(503,'WBS_OPERATOR_EXCEPTION_ROWS_UNAVAILABLE','Retained WBS Payable exception rows are unavailable');
        result=await kernel.listWbsOperatorPayableExceptionRows({tenantId:principal.tenantId,entityId,wbsOperatorPayableAttestationId:requireUuid(parts[7],'wbsOperatorPayableAttestationId'),limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='wbs-exceptions'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI finding reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listAiWbsExceptionFindings!=='function')throw new AccountingApiError(503,'AI_FINDING_READ_UNAVAILABLE','Persisted AI WBS exception findings are unavailable');
        result=await kernel.listAiWbsExceptionFindings({tenantId:principal.tenantId,entityId,limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='assignment-candidates'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI finding assignment-candidate reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?100:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listAiFindingAssignmentCandidates!=='function')throw new AccountingApiError(503,'AI_FINDING_ASSIGNMENT_CANDIDATE_READ_UNAVAILABLE','Persisted AI finding assignment candidates are unavailable');
        result=await kernel.listAiFindingAssignmentCandidates({tenantId:principal.tenantId,entityId,limit});return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='actions'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI finding action reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?100:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listAiFindingActions!=='function')throw new AccountingApiError(503,'AI_FINDING_ACTION_READ_UNAVAILABLE','Persisted AI finding actions are unavailable');
        result=await kernel.listAiFindingActions({tenantId:principal.tenantId,entityId,limit});return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='amortization'&&parts[6]==='schedules'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI amortization schedule reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listAiAmortizationSchedules!=='function')throw new AccountingApiError(503,'AI_AMORTIZATION_SCHEDULE_READ_UNAVAILABLE','Persisted AI amortization schedules are unavailable');
        result=await kernel.listAiAmortizationSchedules({tenantId:principal.tenantId,entityId,limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='amortization'&&parts[6]==='coverage-evidence'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI amortization coverage evidence reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listAiAmortizationCoverageEvidence!=='function')throw new AccountingApiError(503,'AI_AMORTIZATION_COVERAGE_EVIDENCE_READ_UNAVAILABLE','Persisted AI amortization coverage evidence is unavailable');
        result=await kernel.listAiAmortizationCoverageEvidence({tenantId:principal.tenantId,entityId,limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='ai'&&parts[5]==='wbs-payable-draft-proposals'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI proposal reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listAiWbsPayableDraftProposals!=='function')throw new AccountingApiError(503,'AI_WBS_PAYABLE_PROPOSAL_READ_UNAVAILABLE','AI payable proposals are unavailable');
        result=await kernel.listAiWbsPayableDraftProposals({tenantId:principal.tenantId,entityId,limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='prepaid-coverage'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI prepaid coverage finding reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listAiPrepaidCoverageFindings!=='function')throw new AccountingApiError(503,'AI_PREPAID_COVERAGE_FINDING_READ_UNAVAILABLE','Persisted AI prepaid coverage findings are unavailable');
        result=await kernel.listAiPrepaidCoverageFindings({tenantId:principal.tenantId,entityId,limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='duplicate-payables'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI duplicate payable finding reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listAiDuplicatePayableFindings!=='function')throw new AccountingApiError(503,'AI_DUPLICATE_PAYABLE_FINDING_READ_UNAVAILABLE','Persisted AI duplicate payable findings are unavailable');
        result=await kernel.listAiDuplicatePayableFindings({tenantId:principal.tenantId,entityId,limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='unmatched-bank-payments'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI unmatched bank payment finding reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);
        const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listAiUnmatchedBankPaymentFindings!=='function')throw new AccountingApiError(503,'AI_UNMATCHED_BANK_PAYMENT_FINDING_READ_UNAVAILABLE','Persisted AI unmatched bank payment findings are unavailable');
        result=await kernel.listAiUnmatchedBankPaymentFindings({tenantId:principal.tenantId,entityId,limit});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='cost-dimensions'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI cost dimension finding reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listAiCostDimensionFindings!=='function')throw new AccountingApiError(503,'AI_COST_DIMENSION_FINDING_READ_UNAVAILABLE','Persisted AI cost dimension findings are unavailable');
        result=await kernel.listAiCostDimensionFindings({tenantId:principal.tenantId,entityId,limit});return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===7&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='loan-references'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI loan reference finding reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?50:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 100');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listAiLoanReferenceFindings!=='function')throw new AccountingApiError(503,'AI_LOAN_REFERENCE_FINDING_READ_UNAVAILABLE','Persisted AI loan reference findings are unavailable');
        result=await kernel.listAiLoanReferenceFindings({tenantId:principal.tenantId,entityId,limit});return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='ai'&&parts[5]==='analysis-summary'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI accounting analysis summary reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.readAiAccountingAnalysisSummary!=='function')throw new AccountingApiError(503,'AI_ACCOUNTING_ANALYSIS_SUMMARY_UNAVAILABLE','Persisted AI accounting analysis summary is unavailable');
        result=await kernel.readAiAccountingAnalysisSummary({tenantId:principal.tenantId,entityId});return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='ai'&&parts[5]==='skills'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI skill registry reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:{registry_version:AI_ACCOUNTING_SKILL_REGISTRY_VERSION,skills:AI_ACCOUNTING_SKILLS}}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='ai'&&parts[5]==='analysis-reports'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI accounting analysis report reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['limit']);const rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit==null?20:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 50');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.listAiAccountingAnalysisReports!=='function')throw new AccountingApiError(503,'AI_ACCOUNTING_ANALYSIS_REPORT_READ_UNAVAILABLE','Persisted AI accounting analysis reports are unavailable');
        result=await kernel.listAiAccountingAnalysisReports({tenantId:principal.tenantId,entityId,limit});return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='ai'&&parts[5]==='accrual-candidates'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI accrual candidate reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId']);const currentPeriodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId');
        if(typeof aiAccrualCandidateAnalysisServiceFactory!=='function')throw new AccountingApiError(503,'AI_ACCRUAL_ANALYSIS_UNAVAILABLE','AI accrual candidate analysis is not configured');
        const service=await aiAccrualCandidateAnalysisServiceFactory(principal);if(!service||typeof service.analyze!=='function')throw new AccountingApiError(503,'AI_ACCRUAL_ANALYSIS_UNAVAILABLE','AI accrual candidate analysis is not configured');
        result=await service.analyze({tenantId:principal.tenantId,entityId,currentPeriodId});
        const expectedKeys=['accounting_period_id','can_approve','can_create_draft','can_post','can_review','candidates','entity_id','excluded_explicit_non_accrual_evidence_count','status'];
        const resultKeys=result&&typeof result==='object'&&!Array.isArray(result)?Object.keys(result).sort():[];
        const excludedCount=result?.excluded_explicit_non_accrual_evidence_count;
        const candidates=Array.isArray(result?.candidates)&&result.candidates.length<=1000?result.candidates.map(candidate=>safeAiAccrualCandidate(candidate,{entityId,periodId:currentPeriodId})):null;
        if(resultKeys.length!==expectedKeys.length||resultKeys.some((key,index)=>key!==expectedKeys[index])||result.status!=='AI_ACCRUAL_ANALYSIS_COMPLETE'||result.entity_id!==entityId||result.accounting_period_id!==currentPeriodId||!Number.isSafeInteger(excludedCount)||excludedCount<0||excludedCount>1000||candidates===null||candidates.some(candidate=>candidate===null)||new Set(candidates.map(candidate=>candidate.recurring_obligation_id)).size!==candidates.length||result.can_create_draft!==false||result.can_review!==false||result.can_approve!==false||result.can_post!==false)throw new AccountingApiError(502,'AI_ACCRUAL_ANALYSIS_RESPONSE_INVALID','AI accrual candidate analysis returned an unsafe response');
        const safeResult={status:result.status,entity_id:result.entity_id,accounting_period_id:result.accounting_period_id,excluded_explicit_non_accrual_evidence_count:excludedCount,candidates,can_create_draft:false,can_review:false,can_approve:false,can_post:false};
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:safeResult}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='ai'&&parts[5]==='invoice-accounting-classifications'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','AI invoice classification reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,['periodId','limit']);const accountingPeriodId=requireUuid(parsedUrl.searchParams.get('periodId'),'periodId'),rawLimit=parsedUrl.searchParams.get('limit'),limit=rawLimit===null?100:Number(rawLimit);
        if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 500');
        if(typeof aiInvoiceAccountingClassificationServiceFactory!=='function')throw new AccountingApiError(503,'AI_INVOICE_CLASSIFICATION_UNAVAILABLE','AI invoice accounting classification is not configured');
        const service=await aiInvoiceAccountingClassificationServiceFactory(principal);if(!service||typeof service.analyze!=='function')throw new AccountingApiError(503,'AI_INVOICE_CLASSIFICATION_UNAVAILABLE','AI invoice accounting classification is not configured');
        result=await service.analyze({tenantId:principal.tenantId,entityId,accountingPeriodId,limit});
        const expectedResultKeys=['action_flags','classification_counts','eligible_invoice_line_count','results','row_count','scanned_document_count','schema_version','scope'].sort(),counts=result?.classification_counts;
        if(!exactKeys(result,expectedResultKeys)||result.schema_version!=='AI_INVOICE_ACCOUNTING_CLASSIFICATION_BATCH_V1'||!exactKeys(result.scope,['accounting_period_id','entity_id','tenant_id'])||result.scope.tenant_id!==principal.tenantId||result.scope.entity_id!==entityId||result.scope.accounting_period_id!==accountingPeriodId||!safeNoAccountingActions(result.action_flags)||!Array.isArray(result.results)||result.results.length>500||result.results.some(row=>!safeAiInvoiceClassification(row))||result.row_count!==result.results.length||!Number.isSafeInteger(result.scanned_document_count)||result.scanned_document_count<0||!Number.isSafeInteger(result.eligible_invoice_line_count)||result.eligible_invoice_line_count!==result.row_count||!exactKeys(counts,['ACCRUAL_REVIEW','BLOCKED','CAPITALIZATION_REVIEW','EXPENSE','PREPAID_AMORTIZATION'])||Object.values(counts).some(value=>!Number.isSafeInteger(value)||value<0)||Object.values(counts).reduce((sum,value)=>sum+value,0)!==result.row_count)throw new AccountingApiError(502,'AI_INVOICE_CLASSIFICATION_RESPONSE_INVALID','AI invoice accounting classification returned an unsafe response');
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===6&&parts[4]==='ai'&&parts[5]==='invoice-accounting-classification-runs'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['accounting_period_id','limit']);
        const accountingPeriodId=requireUuid(payload.accounting_period_id,'accounting_period_id'),limit=payload.limit??100;
        if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 500');
        if(typeof aiInvoiceAccountingClassificationServiceFactory!=='function')throw new AccountingApiError(503,'AI_INVOICE_CLASSIFICATION_UNAVAILABLE','AI invoice accounting classification is not configured');
        const service=await aiInvoiceAccountingClassificationServiceFactory(principal);if(!service||typeof service.analyzeAndMaterialize!=='function')throw new AccountingApiError(503,'AI_INVOICE_CLASSIFICATION_PERSISTENCE_UNAVAILABLE','AI invoice accounting classification evidence persistence is not configured');
        result=await service.analyzeAndMaterialize({tenantId:principal.tenantId,entityId,accountingPeriodId,limit,idempotencyKey:requireIdempotency(headers)});
        const expected=['accounting_period_id','can_approve','can_create_draft','can_post','can_review','classification_evidence_ids','idempotent','inserted_count','replayed_count','request_hash','row_count','schema_version'];
        if(!exactKeys(result,expected)||result.schema_version!=='AI_INVOICE_ACCOUNTING_CLASSIFICATION_RUN_RECEIPT_V1'||result.accounting_period_id!==accountingPeriodId||!AI_ACCRUAL_HASH.test(result.request_hash||'')||!Array.isArray(result.classification_evidence_ids)||result.classification_evidence_ids.length!==result.row_count||result.classification_evidence_ids.some(id=>!UUID.test(id||''))||!Number.isSafeInteger(result.row_count)||result.row_count<0||result.row_count>500||!Number.isSafeInteger(result.inserted_count)||result.inserted_count<0||!Number.isSafeInteger(result.replayed_count)||result.replayed_count<0||result.inserted_count+result.replayed_count!==result.row_count||typeof result.idempotent!=='boolean'||result.can_create_draft!==false||result.can_review!==false||result.can_approve!==false||result.can_post!==false)throw new AccountingApiError(502,'AI_INVOICE_CLASSIFICATION_RECEIPT_INVALID','AI invoice accounting classification persistence returned an unsafe receipt');
        return {status:result.idempotent?200:201,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===6&&parts[4]==='ai'&&parts[5]==='analysis-explanation'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,[]);
        if(typeof aiAnalysisExplanationServiceFactory!=='function')throw new AccountingApiError(503,'AI_ANALYSIS_EXPLANATION_UNAVAILABLE','AI analysis explanation is not configured');
        const service=await aiAnalysisExplanationServiceFactory(principal);if(!service||typeof service.explain!=='function')throw new AccountingApiError(503,'AI_ANALYSIS_EXPLANATION_UNAVAILABLE','AI analysis explanation is not configured');
        result=await service.explain({tenantId:principal.tenantId,entityId,actorId:principal.actorId,traceId:requireIdempotency(headers)});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===10&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='attachments'&&parts[9]==='uploads'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'READ_COMMAND_HEADERS_FORBIDDEN','Attachment upload reads do not accept command headers');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        requireExactQuery(parsedUrl.searchParams,[]);const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.listWbsPayableAttachmentUploads!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ATTACHMENT_UPLOAD_READ_UNAVAILABLE','Row-bound attachment status is unavailable');
        result=await kernel.listWbsPayableAttachmentUploads({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId')});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&parts[4]==='wbs'&&parts[5]==='control-reconciliation'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(body!==null)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        if(typeof wbsReadServiceFactory!=='function')throw new AccountingApiError(503,'WBS_READ_SERVICE_UNAVAILABLE','WBS read service is unavailable');
        const selection=parseWbsControlReconciliationSelection(parsedUrl.searchParams);
        const service=await wbsReadServiceFactory(principal);
        if(!service||typeof service.readControlReconciliation!=='function')throw new AccountingApiError(503,'WBS_READ_SERVICE_UNAVAILABLE','WBS read service is unavailable');
        result=assertWbsControlReadOnlyResult(await service.readControlReconciliation({tenantId:principal.tenantId,entityId,sourceType:selection.sourceType,scope:selection.scope}));
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='POST'&&parts.length===8&&parts[4]==='wbs'&&parts[5]==='auto-reconciliation'&&parts[6]==='transition-contracts'&&parts[7]==='verify'){
        if(header(headers,'idempotency-key')!=null||header(headers,'if-match')!=null)throw new AccountingApiError(400,'WBS_AUTOREC_TRANSITION_CONTRACT_VERIFY_HEADERS_FORBIDDEN','Signed transition-contract verification is a read-only evidence operation and does not accept command headers');
        allowOnly(payload,['contract']);const contract=payload.contract;if(!contract||typeof contract!=='object'||Array.isArray(contract))throw new AccountingApiError(400,'WBS_AUTOREC_TRANSITION_CONTRACT_INVALID','contract must be a JSON object');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.verifyWbsAutoRecTransitionContract!=='function')throw new AccountingApiError(503,'WBS_AUTOREC_TRANSITION_CONTRACT_UNAVAILABLE','WBS AutoRec transition-contract verification is unavailable');
        result=await kernel.verifyWbsAutoRecTransitionContract({tenantId:principal.tenantId,entityId,contract});
        if(!result||result.signature_verified!==true||result.can_transition_refs!==false||result.can_release!==false||result.can_incur!==false||result.can_reverse!==false||result.can_create_draft!==false||result.can_post!==false)throw new AccountingApiError(422,'WBS_AUTOREC_TRANSITION_CONTRACT_RESPONSE_INVALID','Verified WBS transition-contract evidence must not grant REFS action authority');
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&['ap','ar'].includes(parts[4])&&parts[5]==='adjustments'){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(Object.keys(payload).length)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.listBusinessAdjustments({tenantId:principal.tenantId,entityId,module:parts[4].toUpperCase()});
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method==='GET'&&parts.length===6&&['ap','ar'].includes(parts[4])&&['aging','control-totals'].includes(parts[5])){
        if(header(headers,'idempotency-key')!=null)throw new AccountingApiError(400,'IDEMPOTENCY_KEY_NOT_ALLOWED','Idempotency-Key is not used by read operations');
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by read operations');
        if(Object.keys(payload).length)throw new AccountingApiError(400,'READ_BODY_FORBIDDEN','Read operations do not accept a request body');
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        if(parts[5]==='aging'){
          requireExactQuery(parsedUrl.searchParams,['asOf']);
          const args={tenantId:principal.tenantId,entityId,asOfDate:requireIsoDate(parsedUrl.searchParams.get('asOf'),'asOf')};
          result=await (parts[4]==='ap'?kernel.getApAging(args):kernel.getArAging(args));
        }else{
          requireExactQuery(parsedUrl.searchParams,['periodId']);
          const args={tenantId:principal.tenantId,entityId,periodId:requireUuid(parsedUrl.searchParams.get('periodId'),'periodId')};
          result=await (parts[4]==='ap'?kernel.getApControlTotal(args):kernel.getArControlTotal(args));
        }
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:{ok:true,data:result}};
      }
      if(method!=='POST')throw new AccountingApiError(405,'METHOD_NOT_ALLOWED','Only POST commands and supported GET reads are available');
      const idempotencyKey=requireIdempotency(headers);
      if(parts.length===7&&parts[4]==='wbs'&&parts[5]==='insurance'&&parts[6]==='pc-mapping-proposals'){
        requireExactQuery(parsedUrl.searchParams,[]);if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','Immutable Insurance PC mapping proposal creation does not use If-Match');
        allowOnly(payload,['observationId','expectedObservationHash','reason']);if(!Object.hasOwn(payload,'observationId')||!Object.hasOwn(payload,'expectedObservationHash')||!Object.hasOwn(payload,'reason'))throw new AccountingApiError(400,'REQUIRED_FIELD_MISSING','observationId, expectedObservationHash, and reason are required');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.createWbsInsurancePcMappingProposal!=='function')throw new AccountingApiError(503,'WBS_INSURANCE_PC_MAPPING_PROPOSAL_UNAVAILABLE','Insurance PC mapping proposal creation is unavailable');
        result=await kernel.createWbsInsurancePcMappingProposal({tenantId:principal.tenantId,entityId,observationId:requireUuid(payload.observationId,'observationId'),expectedObservationHash:requireSha256(payload.expectedObservationHash,'expectedObservationHash'),reason:requireReviewReason(payload.reason),idempotencyKey});assertInsurancePcMappingDto(result);
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store','etag':`"${result.revision}"`},body:{ok:true,data:result}};
      }else if(parts.length===9&&parts[4]==='wbs'&&parts[5]==='insurance'&&parts[6]==='pc-mapping-proposals'&&parts[8]==='approve'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['expectedObservationHash','expectedProposalHash','catalogDecisionId','expectedCompanyMappingHash','effectiveFrom','effectiveTo','reason']);
        for(const key of ['expectedObservationHash','expectedProposalHash','catalogDecisionId','expectedCompanyMappingHash','effectiveFrom','reason'])if(!Object.hasOwn(payload,key))throw new AccountingApiError(400,'REQUIRED_FIELD_MISSING',`${key} is required`);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.approveWbsInsurancePcMappingProposal!=='function')throw new AccountingApiError(503,'WBS_INSURANCE_PC_MAPPING_APPROVAL_UNAVAILABLE','Insurance PC mapping approval is unavailable');
        result=await kernel.approveWbsInsurancePcMappingProposal({tenantId:principal.tenantId,entityId,proposalId:requireUuid(parts[7],'proposalId'),expectedRevision:requireRevision(headers),expectedObservationHash:requireSha256(payload.expectedObservationHash,'expectedObservationHash'),expectedProposalHash:requireSha256(payload.expectedProposalHash,'expectedProposalHash'),catalogDecisionId:requireUuid(payload.catalogDecisionId,'catalogDecisionId'),expectedCompanyMappingHash:requireSha256(payload.expectedCompanyMappingHash,'expectedCompanyMappingHash'),effectiveFrom:requireIsoDate(payload.effectiveFrom,'effectiveFrom'),effectiveTo:optionalIsoDate(payload.effectiveTo,'effectiveTo'),reason:requireReviewReason(payload.reason),idempotencyKey});assertInsurancePcMappingDto(result,{approved:true});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store','etag':`"${result.revision}"`},body:{ok:true,data:result}};
      }else if(parts.length===6&&parts[4]==='wbs'&&parts[5]==='company-catalogs'){
        requireExactQuery(parsedUrl.searchParams,[]);if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','Immutable catalog retention does not use If-Match');
        allowOnly(payload,['catalog']);const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.retainWbsCompanyCatalogCandidate!=='function')throw new AccountingApiError(503,'WBS_COMPANY_CATALOG_RETAIN_UNAVAILABLE','Company catalog retention is unavailable');
        result=await kernel.retainWbsCompanyCatalogCandidate({tenantId:principal.tenantId,entityId,catalog:normalizeWbsCompanyCatalogCandidate(payload.catalog),idempotencyKey});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store','etag':`"${result.revision}"`},body:{ok:true,data:result}};
      }else if(parts.length===8&&parts[4]==='wbs'&&parts[5]==='company-catalog-rows'&&parts[7]==='classifications'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['classification','reason']);if(!Object.hasOwn(payload,'classification')||!Object.hasOwn(payload,'reason'))throw new AccountingApiError(400,'REQUIRED_FIELD_MISSING','classification and reason are required');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.classifyWbsCompanyCatalogRow!=='function')throw new AccountingApiError(503,'WBS_COMPANY_CLASSIFICATION_UNAVAILABLE','Company catalog classification is unavailable');
        result=await kernel.classifyWbsCompanyCatalogRow({tenantId:principal.tenantId,entityId,rowId:requireUuid(parts[6],'rowId'),expectedRevision:requireRevision(headers),classification:normalizeWbsCompanyClassification(payload.classification),reason:requireReviewReason(payload.reason),idempotencyKey});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store','etag':`"${result.revision}"`},body:{ok:true,data:result}};
      }else if(parts.length===8&&parts[4]==='wbs'&&parts[5]==='company-catalog-rows'&&parts[7]==='approvals'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['expectedCatalogHash','expectedRowHash','effectiveFrom','effectiveTo','reason']);for(const key of ['expectedCatalogHash','expectedRowHash','effectiveFrom','effectiveTo','reason'])if(!Object.hasOwn(payload,key))throw new AccountingApiError(400,'REQUIRED_FIELD_MISSING',`${key} is required`);
        const effectiveFrom=requireIsoDate(payload.effectiveFrom,'effectiveFrom'),effectiveTo=payload.effectiveTo===null?null:requireIsoDate(payload.effectiveTo,'effectiveTo');if(effectiveTo!==null&&effectiveTo<effectiveFrom)throw new AccountingApiError(400,'INVALID_EFFECTIVE_RANGE','effectiveTo must be null or on/after effectiveFrom');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.approveWbsCompanyCatalogRow!=='function')throw new AccountingApiError(503,'WBS_COMPANY_APPROVAL_UNAVAILABLE','Company catalog approval is unavailable');
        result=await kernel.approveWbsCompanyCatalogRow({tenantId:principal.tenantId,entityId,rowId:requireUuid(parts[6],'rowId'),expectedRevision:requireRevision(headers),expectedCatalogHash:requireSha256(payload.expectedCatalogHash,'expectedCatalogHash'),expectedRowHash:requireSha256(payload.expectedRowHash,'expectedRowHash'),effectiveFrom,effectiveTo,reason:requireReviewReason(payload.reason),idempotencyKey});
        return {status:result.idempotent===true?200:201,headers:{'content-type':'application/json','cache-control':'no-store','etag':`"${result.revision}"`},body:{ok:true,data:result}};
      }else if(parts.length===6&&parts[4]==='reports'&&parts[5]==='financial-statement-snapshot-proposals'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['periodId']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.prepareFinancialStatementSnapshot!=='function')throw new AccountingApiError(503,'STATEMENT_SNAPSHOT_PREPARE_UNAVAILABLE','Statement snapshot preparation is unavailable');
        result=await kernel.prepareFinancialStatementSnapshot({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),idempotencyKey});
      }else if(parts.length===8&&parts[4]==='reports'&&parts[5]==='financial-statement-snapshot-proposals'&&parts[7]==='approve'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,[]);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.approveFinancialStatementSnapshot!=='function')throw new AccountingApiError(503,'STATEMENT_SNAPSHOT_APPROVE_UNAVAILABLE','Statement snapshot approval is unavailable');
        result=await kernel.approveFinancialStatementSnapshot({tenantId:principal.tenantId,entityId,proposalId:requireUuid(parts[6],'proposalId'),idempotencyKey});
      }else if(parts.length===7&&parts[4]==='ai'&&parts[5]==='controlled-test-workflow'&&parts[6]==='run'&&typeof controlledTestAiWorkflowServiceFactory==='function'){
        requireExactQuery(parsedUrl.searchParams,[]);if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','Controlled test AI workflow uses immutable source lineage, not If-Match');
        allowOnly(payload,['periodId','parentSourceDocumentId','coverageStart','coverageEnd','reason']);
        const service=await controlledTestAiWorkflowServiceFactory(principal);
        if(!service||typeof service.run!=='function')throw new AccountingApiError(503,'CONTROLLED_TEST_AI_WORKFLOW_UNAVAILABLE','Controlled test AI workflow is unavailable');
        result=assertControlledTestAiWorkflowResult(await service.run({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),parentSourceDocumentId:requireUuid(payload.parentSourceDocumentId,'parentSourceDocumentId'),coverageStart:requireIsoDate(payload.coverageStart,'coverageStart'),coverageEnd:requireIsoDate(payload.coverageEnd,'coverageEnd'),reason:requireReviewReason(payload.reason),initiatedBy:principal.actorId,idempotencyKey}));
      }else if(parts.length===7&&parts[4]==='ai'&&parts[5]==='amortization'&&parts[6]==='coverage-evidence'){
        requireExactQuery(parsedUrl.searchParams,[]);if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','AI amortization coverage evidence uses immutable source hashes, not If-Match');
        allowOnly(payload,['sourceDocumentId','sourcePayloadHash','coverageStart','coverageEnd','evidenceRef','evidenceHash','extractionMethod']);
        const coverageStart=requireIsoDate(payload.coverageStart,'coverageStart'),coverageEnd=requireIsoDate(payload.coverageEnd,'coverageEnd');
        if(coverageStart.slice(8)!=='01'||coverageEnd!==new Date(Date.UTC(Number(coverageEnd.slice(0,4)),Number(coverageEnd.slice(5,7)),0)).toISOString().slice(0,10)||coverageEnd<coverageStart)throw new AccountingApiError(400,'INVALID_COVERAGE_PERIOD','coverageStart and coverageEnd must be an ordered whole-month range');
        const extractionMethod=payload.extractionMethod;
        if(!['SIGNED_SOURCE_FIELD','SIGNED_ATTACHMENT_FIELD','HUMAN_VERIFIED_SOURCE_FIELD'].includes(extractionMethod))throw new AccountingApiError(400,'INVALID_EXTRACTION_METHOD','extractionMethod must identify signed or human-verified retained evidence');
        if(typeof payload.evidenceRef!=='string'||payload.evidenceRef!==payload.evidenceRef.trim()||payload.evidenceRef.length<1||payload.evidenceRef.length>512||/[\u0000-\u001f\u007f]/.test(payload.evidenceRef))throw new AccountingApiError(400,'INVALID_EVIDENCE_REFERENCE','evidenceRef must be a canonical retained evidence reference');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.recordAiAmortizationCoverageEvidence!=='function')throw new AccountingApiError(503,'AI_AMORTIZATION_COVERAGE_EVIDENCE_UNAVAILABLE','AI amortization coverage evidence persistence is unavailable');
        result=await kernel.recordAiAmortizationCoverageEvidence({tenantId:principal.tenantId,entityId,sourceDocumentId:requireUuid(payload.sourceDocumentId,'sourceDocumentId'),sourcePayloadHash:requireSha256(payload.sourcePayloadHash,'sourcePayloadHash'),coverageStart,coverageEnd,evidenceRef:payload.evidenceRef,evidenceHash:requireSha256(payload.evidenceHash,'evidenceHash'),extractionMethod,idempotencyKey});
        if(!result||!UUID.test(result.ai_amortization_coverage_evidence_id||'')||result.can_create_draft!==false||result.can_review!==false||result.can_approve!==false||result.can_post!==false)throw new AccountingApiError(500,'AI_AMORTIZATION_COVERAGE_EVIDENCE_RESULT_INVALID','AI amortization coverage evidence must remain immutable and cannot grant accounting authority');
      }else if(parts.length===7&&parts[4]==='ai'&&parts[5]==='amortization'&&parts[6]==='proposals'){
        requireExactQuery(parsedUrl.searchParams,[]);if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','AI amortization proposals use immutable source hashes, not If-Match');
        allowOnly(payload,['sourceDocumentId','sourcePayloadHash','coverageStart','coverageEnd','prepaidAccountCode','expenseAccountCode','memberTrace','confidence','reason']);
        const coverageStart=requireIsoDate(payload.coverageStart,'coverageStart'),coverageEnd=requireIsoDate(payload.coverageEnd,'coverageEnd');
        if(coverageStart.slice(8)!=='01'||coverageEnd!==new Date(Date.UTC(Number(coverageEnd.slice(0,4)),Number(coverageEnd.slice(5,7)),0)).toISOString().slice(0,10)||coverageEnd<coverageStart)throw new AccountingApiError(400,'INVALID_COVERAGE_PERIOD','coverageStart and coverageEnd must be an ordered whole-month range');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.proposeAiAmortizationSchedule!=='function')throw new AccountingApiError(503,'AI_AMORTIZATION_PROPOSAL_UNAVAILABLE','AI amortization proposal persistence is unavailable');
        result=await kernel.proposeAiAmortizationSchedule({tenantId:principal.tenantId,entityId,sourceDocumentId:requireUuid(payload.sourceDocumentId,'sourceDocumentId'),sourcePayloadHash:requireSha256(payload.sourcePayloadHash,'sourcePayloadHash'),coverageStart,coverageEnd,prepaidAccountCode:requireAccountCode(payload.prepaidAccountCode),expenseAccountCode:requireAccountCode(payload.expenseAccountCode),memberTrace:requireAiAmortizationMemberTrace(payload.memberTrace),confidence:requireAiConfidence(payload.confidence),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!result||result.status!=='PROPOSED'||!UUID.test(result.ai_amortization_schedule_id||'')||result.can_create_draft!==false||result.can_review!==false||result.can_approve!==false||result.can_post!==false)throw new AccountingApiError(500,'AI_AMORTIZATION_PROPOSAL_RESULT_INVALID','AI amortization proposal must remain an immutable, no-action proposal');
      }else if(parts.length===9&&parts[4]==='ai'&&parts[5]==='amortization'&&parts[6]==='schedules'&&parts[8]==='drafts'){
        requireExactQuery(parsedUrl.searchParams,[]);if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','AI amortization Draft creation uses immutable proposal evidence, not If-Match');
        allowOnly(payload,['periodId','scheduleLineId','expectedProposalHash','attachmentIds','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.createAiAmortizationDraft!=='function')throw new AccountingApiError(503,'AI_AMORTIZATION_DRAFT_UNAVAILABLE','AI amortization Draft creation is unavailable');
        result=await kernel.createAiAmortizationDraft({tenantId:principal.tenantId,entityId,aiAmortizationScheduleId:requireUuid(parts[7],'aiAmortizationScheduleId'),aiAmortizationScheduleLineId:requireUuid(payload.scheduleLineId,'scheduleLineId'),periodId:requireUuid(payload.periodId,'periodId'),expectedProposalHash:requireSha256(payload.expectedProposalHash,'expectedProposalHash'),attachmentIds:requireAttachmentIds(payload.attachmentIds),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!result||result.status!=='DRAFT'||result.journal_type!=='MANUAL'||!UUID.test(result.journal_entry_id||'')||!UUID.test(result.ai_amortization_draft_evidence_id||'')||result.can_create_draft!==false||result.can_review!==false||result.can_approve!==false||result.can_post!==false)throw new AccountingApiError(500,'AI_AMORTIZATION_DRAFT_RESULT_INVALID','AI amortization Draft creation must stop at an unsubmitted standard Draft');
      }else if(parts.length===7&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='assignments'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['findingKind','findingId','findingHash','owner','dueDate']);
        const owner=typeof payload.owner==='string'?payload.owner.trim():'';if(owner.length<2||owner.length>128||!/^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate||''))throw new AccountingApiError(400,'INVALID_AI_FINDING_ASSIGNMENT','AI finding assignment requires a bounded owner and ISO due date');
        const kind=payload.findingKind;if(!['WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT','COST_DIMENSION','LOAN_REFERENCE'].includes(kind))throw new AccountingApiError(400,'INVALID_AI_FINDING_KIND','AI finding assignment kind is unsupported');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.assignAiFindingAction!=='function')throw new AccountingApiError(503,'AI_FINDING_ACTION_UNAVAILABLE','AI finding action persistence is unavailable');
        result=await kernel.assignAiFindingAction({tenantId:principal.tenantId,entityId,findingKind:kind,findingId:requireUuid(payload.findingId,'findingId'),findingHash:requireSha256(payload.findingHash,'findingHash'),owner,dueDate:payload.dueDate,expectedRevision:requireRevision(headers),idempotencyKey});
        if(!result||!UUID.test(result.ai_finding_action_id||'')||result.can_create_draft!==false||result.can_review!==false||result.can_approve!==false||result.can_post!==false)throw new AccountingApiError(500,'AI_FINDING_ACTION_RESULT_INVALID','AI finding action must remain human accountability only and cannot grant accounting authority');
      }else if(parts.length===8&&parts[4]==='ai'&&parts[5]==='findings'&&parts[6]==='actions'&&parts[7]==='resolutions'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['aiFindingActionId','findingHash','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.resolveAiFindingAction!=='function')throw new AccountingApiError(503,'AI_FINDING_ACTION_RESOLUTION_UNAVAILABLE','AI finding action resolution persistence is unavailable');
        result=await kernel.resolveAiFindingAction({tenantId:principal.tenantId,entityId,aiFindingActionId:requireUuid(payload.aiFindingActionId,'aiFindingActionId'),findingHash:requireSha256(payload.findingHash,'findingHash'),reason:requireReviewReason(payload.reason),expectedRevision:requireRevision(headers),idempotencyKey});
        if(!result||result.status!=='RESOLVED'||!UUID.test(result.ai_finding_action_id||'')||result.can_create_draft!==false||result.can_review!==false||result.can_approve!==false||result.can_post!==false)throw new AccountingApiError(500,'AI_FINDING_ACTION_RESOLUTION_RESULT_INVALID','AI finding resolution must retain human accountability only and cannot grant accounting authority');
      }else if(parts.length===6&&parts[4]==='attachments'&&parts[5]==='reservations'){
        if(typeof attachmentServiceFactory!=='function')throw new AccountingApiError(503,'ATTACHMENT_SERVICE_UNAVAILABLE','Attachment service is unavailable');
        allowOnly(payload,['name','mediaType','sizeBytes','contentHash']);const service=await attachmentServiceFactory(principal);result=await service.reserve(principal,{...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===10&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='attachments'&&parts[9]==='reservations'){
        if(typeof attachmentServiceFactory!=='function')throw new AccountingApiError(503,'ATTACHMENT_SERVICE_UNAVAILABLE','Attachment service is unavailable');
        allowOnly(payload,['name','mediaType','sizeBytes','contentHash']);const service=await attachmentServiceFactory(principal);
        if(!service||typeof service.reserveWbsPayable!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ATTACHMENT_RESERVE_UNAVAILABLE','Row-bound attachment reservation is unavailable');
        result=await service.reserveWbsPayable(principal,{...payload,tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),idempotencyKey});
      }else if(parts.length===7&&parts[4]==='attachments'&&parts[6]==='finalize'){
        if(typeof attachmentServiceFactory!=='function')throw new AccountingApiError(503,'ATTACHMENT_SERVICE_UNAVAILABLE','Attachment service is unavailable');
        allowOnly(payload,[]);const service=await attachmentServiceFactory(principal);
        try{result=await service.finalize(principal,{tenantId:principal.tenantId,entityId,attachmentId:requireUuid(parts[5],'attachmentId'),idempotencyKey});}
        catch(error){if(['42501','P0002','ATTACHMENT_NOT_FOUND'].includes(error?.code))throw new AccountingApiError(404,'ATTACHMENT_NOT_FOUND','Attachment was not found');throw error;}
      }else if(parts.length===6&&parts[4]==='wbs'&&parts[5]==='snapshots'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['snapshot']);
        result=await kernel.recordWbsSnapshot({tenantId:principal.tenantId,entityId,snapshot:payload.snapshot,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'){
        if(typeof wbsAdmittedPayableServiceFactory!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ADMISSION_UNAVAILABLE','Admitted WBS payable ingestion is unavailable');
        allowOnly(payload,['snapshot']);const service=await wbsAdmittedPayableServiceFactory(principal);
        if(!service||typeof service.ingest!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ADMISSION_UNAVAILABLE','Admitted WBS payable ingestion is unavailable');
        result=await service.ingest({tenantId:principal.tenantId,entityId,snapshot:payload.snapshot,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='wbs'&&parts[5]==='provider-signed'&&parts[6]==='payables'&&parts[7]==='admissions'){
        requireExactQuery(parsedUrl.searchParams,[]);
        allowOnly(payload,['receipt','requestRawBase64','responseRawBase64','packageRawBase64']);
        if(typeof wbsProviderSignedPayableServiceFactory!=='function')throw new AccountingApiError(503,'WBS_PROVIDER_SIGNED_ADMISSION_UNAVAILABLE','Provider-signed WBS Payable admission is unavailable');
        const service=await wbsProviderSignedPayableServiceFactory(principal);
        if(!service||typeof service.admit!=='function')throw new AccountingApiError(503,'WBS_PROVIDER_SIGNED_ADMISSION_UNAVAILABLE','Provider-signed WBS Payable admission is unavailable');
        result=await service.admit({tenantId:principal.tenantId,entityId,receipt:payload.receipt,requestRawBase64:payload.requestRawBase64,responseRawBase64:payload.responseRawBase64,packageRawBase64:payload.packageRawBase64,idempotencyKey});
      }else if(parts.length===11&&parts[4]==='wbs'&&parts[5]==='provider-signed'&&parts[6]==='final1'&&parts[7]==='insurance'&&parts[8]==='observations'&&parts[10]==='admit'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['expectedObservationHash','expectedApprovalId','expectedDecisionHash','expectedCompanyMappingHash','reason']);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','Insurance Phase B admission uses exact observation and approval hashes, not If-Match');
        if(typeof wbsProviderFinal1RetainedEvidenceServiceFactory!=='function')throw new AccountingApiError(503,'WBS_FINAL1_ADMISSION_UNAVAILABLE','Provider-signed WBS Final-1 retained evidence admission is unavailable');
        const service=await wbsProviderFinal1RetainedEvidenceServiceFactory(principal);
        if(!service||typeof service.resumeInsurance!=='function')throw new AccountingApiError(503,'WBS_INSURANCE_RESUME_UNAVAILABLE','Insurance Final-1 Phase B resume is unavailable');
        result=await service.resumeInsurance({tenantId:principal.tenantId,entityId,observationId:requireUuid(parts[9],'observationId'),expectedObservationHash:requireSha256(payload.expectedObservationHash,'expectedObservationHash'),expectedApprovalId:requireUuid(payload.expectedApprovalId,'expectedApprovalId'),expectedDecisionHash:requireSha256(payload.expectedDecisionHash,'expectedDecisionHash'),expectedCompanyMappingHash:requireSha256(payload.expectedCompanyMappingHash,'expectedCompanyMappingHash'),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===9&&parts[4]==='wbs'&&parts[5]==='provider-signed'&&parts[6]==='final1'&&['payables','insurance','bank','cost','property'].includes(parts[7])&&parts[8]==='admissions'){
        requireExactQuery(parsedUrl.searchParams,[]);
        allowOnly(payload,['receipt','requestRawBase64','responseRawBase64','packageRawBase64']);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','Final-1 admission uses signed hashes and idempotency, not If-Match');
        if(typeof wbsProviderFinal1RetainedEvidenceServiceFactory!=='function')throw new AccountingApiError(503,'WBS_FINAL1_ADMISSION_UNAVAILABLE','Provider-signed WBS Final-1 retained evidence admission is unavailable');
        const service=await wbsProviderFinal1RetainedEvidenceServiceFactory(principal);
        if(!service||typeof service.admit!=='function')throw new AccountingApiError(503,'WBS_FINAL1_ADMISSION_UNAVAILABLE','Provider-signed WBS Final-1 retained evidence admission is unavailable');
        const domain={payables:'PAYABLES',insurance:'INSURANCE',bank:'BANK',cost:'COST',property:'PROPERTY'}[parts[7]];
        result=await service.admit({domain,tenantId:principal.tenantId,entityId,receipt:payload.receipt,requestRawBase64:payload.requestRawBase64,responseRawBase64:payload.responseRawBase64,packageRawBase64:payload.packageRawBase64,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='wbs'&&parts[5]==='operator-attested'&&parts[6]==='payables'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['expectedObservationHash','expectedProviderContentSha256','expectedCompanyCode','dateFrom','dateTo','reason','limit']);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','Operator attestation uses exact observation hashes, not If-Match');
        if(typeof wbsOperatorAttestedPayableServiceFactory!=='function')throw new AccountingApiError(503,'WBS_OPERATOR_ATTEST_UNAVAILABLE','Operator-attested WBS Payable persistence is unavailable');
        const service=await wbsOperatorAttestedPayableServiceFactory(principal);
        if(!service||typeof service.attest!=='function')throw new AccountingApiError(503,'WBS_OPERATOR_ATTEST_UNAVAILABLE','Operator-attested WBS Payable persistence is unavailable');
        const expectedCompanyCode=payload.expectedCompanyCode==null?null:requireDimensionRef(payload.expectedCompanyCode),hasDates=payload.dateFrom!=null||payload.dateTo!=null;
        if(expectedCompanyCode!==null&&!/^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$/.test(expectedCompanyCode))throw new AccountingApiError(400,'INVALID_COMPANY_SCOPE','expectedCompanyCode must be one canonical WBS company code');
        if(hasDates&&(payload.dateFrom==null||payload.dateTo==null))throw new AccountingApiError(400,'INVALID_DATE_SCOPE','dateFrom and dateTo must be supplied together');
        result=await service.attest({tenantId:principal.tenantId,entityId,expectedObservationHash:requireSha256(payload.expectedObservationHash,'expectedObservationHash'),expectedProviderContentSha256:requireBareSha256(payload.expectedProviderContentSha256,'expectedProviderContentSha256'),expectedCompanyCode,dateFrom:hasDates?requireIsoDate(payload.dateFrom,'dateFrom'):null,dateTo:hasDates?requireIsoDate(payload.dateTo,'dateTo'):null,reason:requireReviewReason(payload.reason),limit:Number.isSafeInteger(payload.limit)&&payload.limit>=1&&payload.limit<=10?payload.limit:(()=>{throw new AccountingApiError(400,'INVALID_LIMIT','limit must be an integer from 1 to 10');})(),idempotencyKey});
      }else if(parts.length===10&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='attachments'&&parts[9]==='bindings'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['attachmentId','expectedSourceVersion','expectedReceiptHash','expectedProviderReceiptHash','expectedEvidenceHash','expectedAttachmentContentHash','expectedAttachmentStorageVersion','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.bindWbsPayableAttachment!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ATTACHMENT_BIND_UNAVAILABLE','WBS Payable attachment binding is unavailable');
        const bound=await kernel.bindWbsPayableAttachment({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),attachmentId:requireUuid(payload.attachmentId,'attachmentId'),expectedRevision:requireRevision(headers),expectedSourceVersion:requireSourceVersion(payload.expectedSourceVersion,'expectedSourceVersion'),expectedReceiptHash:requireSha256(payload.expectedReceiptHash,'expectedReceiptHash'),expectedProviderReceiptHash:requireSha256(payload.expectedProviderReceiptHash,'expectedProviderReceiptHash'),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),expectedAttachmentContentHash:requireSha256(payload.expectedAttachmentContentHash,'expectedAttachmentContentHash'),expectedAttachmentStorageVersion:requireStorageVersion(payload.expectedAttachmentStorageVersion,'expectedAttachmentStorageVersion'),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!bound||bound.status!=='BOUND_EVIDENCE_ONLY'||bound.can_review!==false||bound.can_create_draft!==false||bound.can_approve!==false||bound.can_post!==false)throw new AccountingApiError(500,'WBS_PAYABLE_ATTACHMENT_BIND_RESULT_INVALID','WBS Payable attachment binding must remain evidence-only');
        result=bound;
      }else if(parts.length===11&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='attachments'&&parts[9]==='bindings'&&parts[10]==='from-upload'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['attachmentId','reason']);const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.bindWbsPayableUploadedAttachment!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_ATTACHMENT_BIND_UNAVAILABLE','Safe row-bound attachment binding is unavailable');
        const bound=await kernel.bindWbsPayableUploadedAttachment({tenantId:principal.tenantId,entityId,
          wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),attachmentId:requireUuid(payload.attachmentId,'attachmentId'),
          expectedRevision:requireRevision(headers),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!bound||bound.status!=='BOUND_EVIDENCE_ONLY'||bound.can_review!==false||bound.can_create_draft!==false||bound.can_approve!==false||bound.can_post!==false)throw new AccountingApiError(500,'WBS_PAYABLE_ATTACHMENT_BIND_RESULT_INVALID','WBS Payable attachment binding must remain evidence-only');
        result=bound;
      }else if(parts.length===9&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='reviews'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['periodId','expectedSourceVersion','expectedReceiptHash','expectedEvidenceHash','settingSnapshotId','mappingSnapshotId','attachmentIds','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.reviewWbsPayable!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_REVIEW_UNAVAILABLE','WBS payable review is unavailable');
        const reviewed=await kernel.reviewWbsPayable({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),periodId:requireUuid(payload.periodId,'periodId'),expectedRevision:requireRevision(headers),expectedSourceVersion:requireSourceVersion(payload.expectedSourceVersion,'expectedSourceVersion'),expectedReceiptHash:requireSha256(payload.expectedReceiptHash,'expectedReceiptHash'),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),settingSnapshotId:requireUuid(payload.settingSnapshotId,'settingSnapshotId'),mappingSnapshotId:requireUuid(payload.mappingSnapshotId,'mappingSnapshotId'),attachmentIds:requireAttachmentIds(payload.attachmentIds),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!reviewed||reviewed.can_create_draft!==false||reviewed.can_approve!==false||reviewed.can_post!==false)throw new AccountingApiError(500,'WBS_PAYABLE_REVIEW_RESULT_INVALID','WBS payable review must remain evidence-only');
        result=reviewed;
      }else if(parts.length===9&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='payables'&&parts[8]==='drafts'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['reviewEvidenceId','expectedEvidenceHash','mappingSnapshotId','attachmentIds','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.createWbsPayableApDraft!=='function')throw new AccountingApiError(503,'WBS_PAYABLE_AP_DRAFT_UNAVAILABLE','WBS Payable AP Draft creation is unavailable');
        const drafted=await kernel.createWbsPayableApDraft({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),reviewEvidenceId:requireUuid(payload.reviewEvidenceId,'reviewEvidenceId'),expectedRevision:requireRevision(headers),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),mappingSnapshotId:requireUuid(payload.mappingSnapshotId,'mappingSnapshotId'),attachmentIds:requireAttachmentIds(payload.attachmentIds),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!drafted||drafted.status!=='DRAFT'||drafted.journal_type!=='AUTO'||drafted.can_create_draft!==false||drafted.can_submit!==false||drafted.can_review!==false||drafted.can_approve!==false||drafted.can_post!==false)throw new AccountingApiError(500,'WBS_PAYABLE_AP_DRAFT_RESULT_INVALID','WBS Payable AP Draft creation must stop at an unsubmitted AUTO Draft');
        result=drafted;
      }else if(parts.length===9&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='cost-cwip'&&parts[8]==='reviews'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['periodId','expectedSourceVersion','expectedReceiptHash','expectedEvidenceHash','settingSnapshotId','mappingSnapshotId','reason']);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','Cost-to-CWIP review uses immutable signed evidence selectors, not a browser revision');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.reviewWbsCostCwip!=='function')throw new AccountingApiError(503,'WBS_COST_CWIP_REVIEW_UNAVAILABLE','Cost-to-CWIP review is unavailable');
        const reviewed=await kernel.reviewWbsCostCwip({tenantId:principal.tenantId,entityId,wbsInboundRowId:requireUuid(parts[7],'wbsInboundRowId'),periodId:requireUuid(payload.periodId,'periodId'),expectedSourceVersion:requireSourceVersion(payload.expectedSourceVersion,'expectedSourceVersion'),expectedReceiptHash:requireSha256(payload.expectedReceiptHash,'expectedReceiptHash'),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),settingSnapshotId:requireUuid(payload.settingSnapshotId,'settingSnapshotId'),mappingSnapshotId:requireUuid(payload.mappingSnapshotId,'mappingSnapshotId'),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!reviewed||reviewed.status!=='READY_FOR_DRAFT'||reviewed.can_create_draft!==false||reviewed.can_approve!==false||reviewed.can_post!==false)throw new AccountingApiError(500,'WBS_COST_CWIP_REVIEW_RESULT_INVALID','Cost-to-CWIP review must preserve evidence only and cannot create or post a journal');
        result=reviewed;
      }else if(parts.length===10&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='cost-cwip'&&parts[7]==='reviews'&&parts[9]==='drafts'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['expectedEvidenceHash','reason']);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','Cost-to-CWIP Draft creation uses immutable reviewed evidence, not a browser revision');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.createWbsCostCwipDraft!=='function')throw new AccountingApiError(503,'WBS_COST_CWIP_DRAFT_UNAVAILABLE','Cost-to-CWIP Draft creation is unavailable');
        const drafted=await kernel.createWbsCostCwipDraft({tenantId:principal.tenantId,entityId,reviewEvidenceId:requireUuid(parts[8],'reviewEvidenceId'),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!drafted||drafted.status!=='DRAFT'||drafted.journal_type!=='AUTO'||drafted.can_create_draft!==false||drafted.can_submit!==false||drafted.can_review!==false||drafted.can_approve!==false||drafted.can_post!==false)throw new AccountingApiError(500,'WBS_COST_CWIP_DRAFT_RESULT_INVALID','Cost-to-CWIP Draft creation must stop at an unsubmitted AUTO Draft');
        result=drafted;
      }else if(parts.length===8&&parts[4]==='ai'&&parts[5]==='wbs-payable-draft-proposals'&&parts[7]==='reviews'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['decision','reason']);
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.reviewAiWbsPayableDraftProposal!=='function')throw new AccountingApiError(503,'AI_WBS_PAYABLE_PROPOSAL_REVIEW_UNAVAILABLE','AI payable proposal review is unavailable');
        const reviewed=await kernel.reviewAiWbsPayableDraftProposal({tenantId:principal.tenantId,entityId,proposalId:requireUuid(parts[6],'proposalId'),decision:typeof payload.decision==='string'?payload.decision:'',reason:requireReviewReason(payload.reason),idempotencyKey});
        if(!reviewed||!['ACCEPTED','REJECTED'].includes(reviewed.decision)||reviewed.can_create_draft!==false||reviewed.can_submit!==false||reviewed.can_approve!==false||reviewed.can_post!==false)throw new AccountingApiError(500,'AI_WBS_PAYABLE_PROPOSAL_REVIEW_RESULT_INVALID','AI payable proposal review must not create or advance a journal');
        result=reviewed;
      }else if(parts.length===7&&parts[4]==='wbs'&&parts[5]==='inbound'&&parts[6]==='bank-statements'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used by signed WBS bank admission');
        allowOnly(payload,['admission']);const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.admitWbsSignedBankStatement!=='function')throw new AccountingApiError(503,'WBS_BANK_ADMISSION_UNAVAILABLE','Signed WBS bank admission is unavailable');
        const admitted=await kernel.admitWbsSignedBankStatement({tenantId:principal.tenantId,entityId,admission:payload.admission,idempotencyKey});
        result={...admitted,can_match:false,can_reconcile:false,can_create_draft:false,can_post:false};
      }else if(parts.length===6&&parts[4]==='journal-entries'&&parts[5]==='manual'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createManualJournal({...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='journal-entries'&&parts[5]==='auto'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createAutoJournal({...payload,tenantId:principal.tenantId,entityId,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='bank'&&parts[5]==='transactions'&&parts[7]==='matches'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['paymentOccurrenceId','expectedOccurrenceRevision','reason']);
        if(!Number.isSafeInteger(payload.expectedOccurrenceRevision)||payload.expectedOccurrenceRevision<0)throw new AccountingApiError(400,'INVALID_REVISION','expectedOccurrenceRevision must be a non-negative safe integer');
        result=await kernel.createBankPaymentMatch({tenantId:principal.tenantId,entityId,bankSourceId:requireUuid(parts[6],'bankSourceId'),paymentOccurrenceId:requireUuid(payload.paymentOccurrenceId,'paymentOccurrenceId'),expectedBankVersion:requireRevision(headers),expectedOccurrenceVersion:payload.expectedOccurrenceRevision,reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===10&&parts[4]==='bank'&&parts[5]==='transactions'&&parts[7]==='matches'&&parts[9]==='unmatch'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['reason']);
        result=await kernel.unmatchBankPayment({tenantId:principal.tenantId,entityId,bankSourceId:requireUuid(parts[6],'bankSourceId'),bankMatchId:requireUuid(parts[8],'bankMatchId'),expectedMatchVersion:requireRevision(headers),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===10&&parts[4]==='wbs'&&parts[5]==='auto-reconciliation'&&parts[6]==='match-reviews'&&parts[8]==='g11-drafts'){
        requireExactQuery(parsedUrl.searchParams,[]);if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','G11 Draft creation is bound to immutable review evidence');
        allowOnly(payload,['periodId','expectedEvidenceHash','reason']);
        const kernel=await kernelFactory(principal),args={tenantId:principal.tenantId,entityId,reviewId:requireUuid(parts[7],'reviewId'),periodId:requireUuid(payload.periodId,'periodId'),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),reason:requireReviewReason(payload.reason),idempotencyKey};
        if(parts[9]==='payable-incur'&&typeof kernel?.createWbsAutoRecPayableIncurDraft==='function')result=await kernel.createWbsAutoRecPayableIncurDraft(args);
        else if(parts[9]==='autoc'&&typeof kernel?.createWbsAutoRecAutocDraft==='function')result=await kernel.createWbsAutoRecAutocDraft(args);
        else throw new AccountingApiError(404,'WBS_AUTOREC_G11_DRAFT_ROUTE_NOT_FOUND','Unknown or unavailable G11 Draft producer');
      }else if(parts.length===9&&parts[4]==='wbs'&&parts[5]==='auto-reconciliation'&&parts[6]==='match-reviews'&&parts[8]==='g11-incur'){
        requireExactQuery(parsedUrl.searchParams,[]);if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','G11 INCUR is bound to immutable review and posted evidence');
        allowOnly(payload,['expectedEvidenceHash','reason']);const kernel=await kernelFactory(principal);
        if(!kernel||typeof kernel.finalizeWbsAutoRecG11Incur!=='function')throw new AccountingApiError(503,'WBS_AUTOREC_G11_INCUR_UNAVAILABLE','AutoRec G11 INCUR is unavailable');
        result=await kernel.finalizeWbsAutoRecG11Incur({tenantId:principal.tenantId,entityId,reviewId:requireUuid(parts[7],'reviewId'),expectedEvidenceHash:requireSha256(payload.expectedEvidenceHash,'expectedEvidenceHash'),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===7&&parts[4]==='wbs'&&parts[5]==='auto-reconciliation'&&parts[6]==='match-reviews'){
        requireExactQuery(parsedUrl.searchParams,[]);allowOnly(payload,['reviewCandidateId','candidateHash','bankMatchId','decision','reason']);
        const decision=typeof payload.decision==='string'?payload.decision.toUpperCase():'';
        if(!['ACCEPTED','REJECTED'].includes(decision))throw new AccountingApiError(400,'INVALID_REVIEW_DECISION','decision must be ACCEPTED or REJECTED');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.reviewWbsAutoRecBankMatch!=='function')throw new AccountingApiError(503,'WBS_AUTOREC_MATCH_REVIEW_UNAVAILABLE','AutoRec Bank Match review is unavailable');
        result=await kernel.reviewWbsAutoRecBankMatch({tenantId:principal.tenantId,entityId,reviewCandidateId:payload.reviewCandidateId,candidateHash:requireSha256(payload.candidateHash,'candidateHash'),bankMatchId:requireUuid(payload.bankMatchId,'bankMatchId'),expectedMatchRevision:requireRevision(headers),decision,reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===6&&parts[4]==='bank'&&parts[5]==='reconciliations'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['bankAccountRef','statementEndingDate','statementOpeningBalance','statementEndingBalance','reason']);
        result=await kernel.startReconciliation({tenantId:principal.tenantId,entityId,bankAccountRef:requireBankAccountRef(payload.bankAccountRef),statementEndingDate:requireIsoDate(payload.statementEndingDate,'statementEndingDate'),statementOpeningBalance:requireDecimalAmount(payload.statementOpeningBalance,'statementOpeningBalance'),statementEndingBalance:requireDecimalAmount(payload.statementEndingBalance,'statementEndingBalance'),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===7&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[6]==='from-admitted-statement'){
        requireExactQuery(parsedUrl.searchParams,[]);
        if(header(headers,'if-match')!=null)throw new AccountingApiError(400,'IF_MATCH_NOT_ALLOWED','If-Match is not used when starting from an immutable admitted statement');
        const kernel=await kernelFactory(principal);if(!kernel||typeof kernel.startReconciliationFromAdmittedWbsStatement!=='function')throw new AccountingApiError(503,'WBS_STATEMENT_RECONCILIATION_UNAVAILABLE','Admitted statement reconciliation is unavailable');
        allowOnly(payload,['statementReceiptId','reason']);
        result=await kernel.startReconciliationFromAdmittedWbsStatement({tenantId:principal.tenantId,entityId,statementReceiptId:requireUuid(payload.statementReceiptId,'statementReceiptId'),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===10&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='items'&&parts[9]==='clearance'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['clear','expectedBankRevision','reason']);
        if(typeof payload.clear!=='boolean')throw new AccountingApiError(400,'INVALID_CLEARANCE_STATE','clear must be an explicit boolean');
        if(!Number.isSafeInteger(payload.expectedBankRevision)||payload.expectedBankRevision<0)throw new AccountingApiError(400,'INVALID_REVISION','expectedBankRevision must be a non-negative safe integer');
        result=await kernel.setReconciliationClearance({tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId'),bankSourceId:requireUuid(parts[8],'bankSourceId'),expectedReconciliationVersion:requireRevision(headers),expectedBankVersion:payload.expectedBankRevision,clear:payload.clear,reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===10&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='adjustment-items'&&parts[9]==='clearance'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['clear','expectedBankRevision','reason']);
        if(typeof payload.clear!=='boolean')throw new AccountingApiError(400,'INVALID_CLEARANCE_STATE','clear must be an explicit boolean');
        if(!Number.isSafeInteger(payload.expectedBankRevision)||payload.expectedBankRevision<0)throw new AccountingApiError(400,'INVALID_REVISION','expectedBankRevision must be a non-negative safe integer');
        result=await kernel.setReconciliationAdjustmentClearance({tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId'),bankSourceId:requireUuid(parts[8],'bankSourceId'),expectedReconciliationVersion:requireRevision(headers),expectedBankVersion:payload.expectedBankRevision,clear:payload.clear,reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===9&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='transitions'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['reason']);
        const action=parts[8].toUpperCase();if(!['REVIEW','SIGN_OFF','REOPEN'].includes(action))throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
        result=await kernel.transitionReconciliation({tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId'),action,expectedVersion:requireRevision(headers),reason:requireReviewReason(payload.reason),idempotencyKey});
      }else if(parts.length===8&&parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='adjustment-drafts'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['bankSourceId','periodId','journalNumber','journalDate','currency','description','lines','attachmentIds','reason']);
        result=await kernel.createReconciliationAdjustmentDraft({
          tenantId:principal.tenantId,entityId,reconciliationId:requireUuid(parts[6],'reconciliationId'),expectedReconciliationVersion:requireRevision(headers),
          bankSourceId:requireUuid(payload.bankSourceId,'bankSourceId'),periodId:requireUuid(payload.periodId,'periodId'),journalNumber:payload.journalNumber,journalDate:requireIsoDate(payload.journalDate,'journalDate'),
          currency:payload.currency,description:payload.description??null,lines:payload.lines,attachmentIds:payload.attachmentIds,
          reason:requireReviewReason(payload.reason),idempotencyKey
        });
      }else if(parts.length===8&&parts[4]==='journal-entries'&&parts[6]==='transitions'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.transitionJournal({tenantId:principal.tenantId,entityId,journalEntryId:requireUuid(parts[5],'journalEntryId'),action:parts[7].toUpperCase(),expectedRevision:requireRevision(headers),reason:payload.reason??null,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='journal-entries'&&parts[6]==='post'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.postJournal({tenantId:principal.tenantId,entityId,journalEntryId:requireUuid(parts[5],'journalEntryId'),periodId:requireUuid(payload.periodId,'periodId'),expectedRevision:requireRevision(headers),idempotencyKey});
      }else if(parts.length===8&&parts[4]==='journal-entries'&&parts[6]==='adjustments'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        result=await kernel.createJournalAdjustment({...payload,action:parts[7].toUpperCase(),tenantId:principal.tenantId,entityId,originalJournalEntryId:requireUuid(parts[5],'journalEntryId'),idempotencyKey});
      }else if(parts.length===6&&((parts[4]==='ap'&&parts[5]==='bills')||(parts[4]==='ar'&&parts[5]==='invoices'))){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','documentNumber','counterpartyRef','counterpartyName','currency','accountingDate','dueDate','amount','offsetAccountCode','description','attachmentIds']);
        result=await kernel.createBusinessDocument({tenantId:principal.tenantId,entityId,documentKind:parts[4]==='ap'?'AP_BILL':'AR_INVOICE',periodId:requireUuid(payload.periodId,'periodId'),documentNumber:payload.documentNumber,counterpartyRef:payload.counterpartyRef,counterpartyName:payload.counterpartyName,currency:payload.currency,accountingDate:payload.accountingDate,dueDate:payload.dueDate??null,amount:payload.amount,offsetAccountCode:payload.offsetAccountCode,description:payload.description??null,attachmentIds:payload.attachmentIds,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='ap'&&parts[5]==='bills'&&parts[6].length>0&&parts[6]!=='voids'){
        throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      }else if(parts.length===8&&parts[4]==='ap'&&parts[5]==='bills'&&parts[7]==='voids'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','journalNumber','journalDate','reason']);
        result=await kernel.createApBillVoid({tenantId:principal.tenantId,entityId,businessDocumentId:requireUuid(parts[6],'businessDocumentId'),periodId:requireUuid(payload.periodId,'periodId'),expectedVersion:requireRevision(headers),journalNumber:payload.journalNumber,journalDate:payload.journalDate,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ap'&&parts[5]==='bills'&&parts[7]==='payments'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','paymentNumber','paymentDate','cashAccountCode','bankMemberRef','amount','reason']);
        result=await kernel.createApPayment({tenantId:principal.tenantId,entityId,businessDocumentId:requireUuid(parts[6],'businessDocumentId'),periodId:requireUuid(payload.periodId,'periodId'),paymentNumber:payload.paymentNumber,paymentDate:payload.paymentDate,cashAccountCode:payload.cashAccountCode,bankMemberRef:payload.bankMemberRef??null,amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='ap'&&parts[5]==='vendor-credits'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','creditNumber','creditDate','vendorRef','vendorName','amount','lines','reason']);
        result=await kernel.createApVendorCredit({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),creditNumber:payload.creditNumber,creditDate:payload.creditDate,vendorRef:payload.vendorRef,vendorName:payload.vendorName,amount:payload.amount,lines:payload.lines,reason:payload.reason,idempotencyKey});
      }else if(parts.length===7&&parts[4]==='ap'&&parts[5]==='vendor-credits'&&parts[6].length>0){
        throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      }else if(parts.length===8&&parts[4]==='ap'&&parts[5]==='vendor-credits'&&parts[7]==='allocations'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['businessDocumentId','amount','reason']);
        result=await kernel.applyApVendorCredit({tenantId:principal.tenantId,entityId,businessAdjustmentId:requireUuid(parts[6],'businessAdjustmentId'),businessDocumentId:requireUuid(payload.businessDocumentId,'businessDocumentId'),amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ar'&&parts[5]==='invoices'&&parts[7]==='receipts'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','receiptNumber','receiptDate','cashAccountCode','bankMemberRef','amount','reason']);
        result=await kernel.createArReceipt({tenantId:principal.tenantId,entityId,businessDocumentId:requireUuid(parts[6],'businessDocumentId'),periodId:requireUuid(payload.periodId,'periodId'),receiptNumber:payload.receiptNumber,receiptDate:payload.receiptDate,cashAccountCode:payload.cashAccountCode,bankMemberRef:payload.bankMemberRef??null,amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ar'&&parts[5]==='receipts'&&parts[7]==='reversals'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','journalNumber','journalDate','reason']);
        result=await kernel.createArReceiptReversal({tenantId:principal.tenantId,entityId,sourceOccurrenceId:requireUuid(parts[6],'sourceOccurrenceId'),periodId:requireUuid(payload.periodId,'periodId'),journalNumber:payload.journalNumber,journalDate:payload.journalDate,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ar'&&parts[5]==='credit-memos'&&parts[7]==='allocations'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['businessDocumentId','amount','reason']);
        result=await kernel.applyArCreditMemo({tenantId:principal.tenantId,entityId,businessAdjustmentId:requireUuid(parts[6],'businessAdjustmentId'),businessDocumentId:requireUuid(payload.businessDocumentId,'businessDocumentId'),amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='ar'&&parts[5]==='refunds'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','sourceAdjustmentId','refundNumber','refundDate','cashAccountCode','amount','reason']);
        result=await kernel.createArRefund({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),sourceAdjustmentId:requireUuid(payload.sourceAdjustmentId,'sourceAdjustmentId'),refundNumber:payload.refundNumber,refundDate:payload.refundDate,cashAccountCode:payload.cashAccountCode,amount:payload.amount,reason:payload.reason,idempotencyKey});
      }else if(parts.length===8&&parts[4]==='ap'&&parts[5]==='payments'&&parts[7]==='reversals'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','journalNumber','journalDate','reason']);
        result=await kernel.createApPaymentReversal({tenantId:principal.tenantId,entityId,sourceOccurrenceId:requireUuid(parts[6],'sourceOccurrenceId'),periodId:requireUuid(payload.periodId,'periodId'),journalNumber:payload.journalNumber,journalDate:payload.journalDate,reason:payload.reason,idempotencyKey});
      }else if(parts.length===6&&parts[4]==='ar'&&parts[5]==='credit-memos'){
        const kernel=await kernelFactory(principal);if(!kernel)throw new Error('Kernel factory returned no kernel');
        allowOnly(payload,['periodId','memoNumber','memoDate','customerRef','customerName','amount','lines','reason']);
        result=await kernel.createArCreditMemo({tenantId:principal.tenantId,entityId,periodId:requireUuid(payload.periodId,'periodId'),memoNumber:payload.memoNumber,memoDate:payload.memoDate,customerRef:payload.customerRef,customerName:payload.customerName,amount:payload.amount,lines:payload.lines,reason:payload.reason,idempotencyKey});
      }else throw new AccountingApiError(404,'ROUTE_NOT_FOUND','Route not found');
      const responseHeaders={'content-type':'application/json','cache-control':'no-store'};
      if(Number.isSafeInteger(result?.revision)&&result.revision>=0)responseHeaders.etag=`"${result.revision}"`;
      return {status:result?.idempotent?200:201,headers:responseHeaders,body:{ok:true,data:result}};
    }catch(error){return problemFor(error);}
  };
}

const corsHeaders=(origin,allowedOrigins)=>origin&&allowedOrigins.has(origin)?{'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization, content-type, idempotency-key, if-match, cache-control','access-control-max-age':'600','vary':'Origin'}:{};

export function createAccountingHttpServer({authenticate,kernelFactory,attachmentServiceFactory,wbsReadServiceFactory,wbsLivePilotServiceFactory,wbsTestImportServiceFactory,controlledTestAiWorkflowServiceFactory,wbsAdmittedPayableServiceFactory,wbsProviderSignedPayableServiceFactory,wbsProviderFinal1RetainedEvidenceServiceFactory,wbsOperatorAttestedPayableServiceFactory,aiAnalysisExplanationServiceFactory,aiAccrualCandidateAnalysisServiceFactory,aiInvoiceAccountingClassificationServiceFactory,stage1SelfGrantServiceFactory,stage1SelfWbsReadUpgradeServiceFactory,stage1SelfWbsOperatorUpgradeServiceFactory,stage1SelfControlledTestWorkflowUpgradeServiceFactory,maxBodyBytes=1024*1024,healthCheck,releaseSha=null,allowedOrigins=[]}={}){
  const allowed=new Set(allowedOrigins);
  const release=typeof releaseSha==='string'&&/^[0-9a-f]{40}$/i.test(releaseSha)?releaseSha.toLowerCase():'unversioned';
  const dispatch=createAccountingApi({authenticate,kernelFactory,attachmentServiceFactory,wbsReadServiceFactory,wbsLivePilotServiceFactory,wbsTestImportServiceFactory,controlledTestAiWorkflowServiceFactory,wbsAdmittedPayableServiceFactory,wbsProviderSignedPayableServiceFactory,wbsProviderFinal1RetainedEvidenceServiceFactory,wbsOperatorAttestedPayableServiceFactory,aiAnalysisExplanationServiceFactory,aiAccrualCandidateAnalysisServiceFactory,aiInvoiceAccountingClassificationServiceFactory,stage1SelfGrantServiceFactory,stage1SelfWbsReadUpgradeServiceFactory,stage1SelfWbsOperatorUpgradeServiceFactory,stage1SelfControlledTestWorkflowUpgradeServiceFactory});
  return createServer(async(req,res)=>{
    const chunks=[];let size=0;
    try{
      const pathname=new URL(req.url,'http://refs.local').pathname;
      const origin=typeof req.headers.origin==='string'?req.headers.origin:null;
      if(origin&& !allowed.has(origin))throw new AccountingApiError(403,'CORS_ORIGIN_FORBIDDEN','Origin is not allowed');
      const cors=corsHeaders(origin,allowed);
      if(req.method==='OPTIONS'){
        if(!origin)throw new AccountingApiError(400,'CORS_ORIGIN_REQUIRED','Origin is required for CORS preflight');
        res.writeHead(204,cors);res.end();return;
      }
      if(req.method==='GET'&&pathname==='/health/live'){
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',...cors});res.end(JSON.stringify({ok:true,status:'live',release}));return;
      }
      if(req.method==='GET'&&pathname==='/health/ready'){
        let ready=false;try{ready=typeof healthCheck==='function'&&await healthCheck()===true;}catch{}
        res.writeHead(ready?200:503,{'content-type':'application/json','cache-control':'no-store',...cors});res.end(JSON.stringify({ok:ready,status:ready?'ready':'not_ready',release}));return;
      }
      for await(const chunk of req){size+=chunk.length;if(size>maxBodyBytes)throw new AccountingApiError(413,'BODY_TOO_LARGE','Request body exceeds limit');chunks.push(chunk);}
      let body=null;if(chunks.length){try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AccountingApiError(400,'INVALID_JSON','Request body is not valid JSON');}}
      const response=await dispatch({method:req.method,url:req.url,headers:req.headers,body});res.writeHead(response.status,{...response.headers,...cors});res.end(JSON.stringify(response.body));
    }catch(error){const problem=problemFor(error);res.writeHead(problem.status,problem.headers);res.end(JSON.stringify(problem.body));}
  });
}
