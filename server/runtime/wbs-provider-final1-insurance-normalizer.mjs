import {createHash} from 'node:crypto';
import {canonicalRequestBody,canonicalRequestHash} from './request-hash.mjs';
import {WbsSignedDeliveryAdmissionError} from './wbs-signed-delivery-admission.mjs';
import {requireVerifiedWbsProviderFinal1InsuranceEvidence} from './wbs-provider-final1-delivery.mjs';

const fail=(code,message)=>{throw new WbsSignedDeliveryAdmissionError(code,message);};
const canonical=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const hash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const deepFreeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;};
const lastDay=value=>{const date=new Date(`${value}T00:00:00.000Z`);return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();};
const inclusiveMonths=(start,end)=>((Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5,7))-Number(start.slice(5,7))+1);

function normalizeRow(row,verified,sourceRowOrdinal){
  const rawRow=deepFreeze(structuredClone(row)),rawRowHash=hash(canonical(rawRow)),exceptions=[];
  if(!row.pc_code)exceptions.push('INSURANCE_ENTITY_MAPPING_REQUIRED');
  if(!row.start_date||!row.expire_date)exceptions.push('INSURANCE_COVERAGE_DATE_MISSING');
  else if(row.start_date>row.expire_date)exceptions.push('INSURANCE_COVERAGE_DATE_INVALID');
  const premiumPositive=/^\d/.test(row.final_premium)&&!/^0+\.00$/.test(row.final_premium);
  if(!premiumPositive)exceptions.push('INSURANCE_PREMIUM_NONPOSITIVE');
  const wholeMonthTwelve=Boolean(row.start_date&&row.expire_date&&row.start_date<=row.expire_date&&row.start_date.endsWith('-01')&&Number(row.expire_date.slice(8,10))===lastDay(row.expire_date)&&inclusiveMonths(row.start_date,row.expire_date)===12);
  if(row.start_date&&row.expire_date&&row.start_date<=row.expire_date&&!wholeMonthTwelve)exceptions.push('INSURANCE_COVERAGE_NORMALIZATION_REQUIRED');
  const candidate=exceptions.length===0;
  // Only the database can attach a Controller decision id, match count, and
  // resolved entity.  Do not turn the package-level mapping hash into a fake
  // per-row approval assertion here.
  const companyMappingTrace=deepFreeze({pc_code:row.pc_code||null,mapping_authority:'UNRESOLVED_PENDING_SERVER_DECISION',controller_approved:false,company_mapping_hash:verified.company_mapping_hash});
  return deepFreeze({source_system:'WBS',source_module:'payable',source_domain:'insurance',source_record_id:row.policy_id,source_primary_key:String(row.id),source_row_ordinal:sourceRowOrdinal,source_surface:{database:'wb_insurance',table:'insurance_data',stable_keys:['id','policy_id']},source_version:`final1:${verified.snapshot_id}:${rawRowHash.slice(7,23)}`,raw_row:rawRow,raw_row_hash:rawRowHash,provider_package_hash:verified.package_hash,provider_raw_package_hash:verified.raw_package_hash,provider_snapshot_id:verified.snapshot_id,provider_company_code:verified.company_code,company_mapping_hash:verified.company_mapping_hash,company_mapping_trace:companyMappingTrace,currency:'USD',currency_authority:'REFS_BUSINESS_OWNER_CONFIRMED_CURRENCY',normalized:{policyId:row.policy_id,sourceId:String(row.id),pcCode:row.pc_code,propertyCode:row.property_code||null,unitCode:row.unit_code||null,policyNumber:row.policy_number||null,carrier:row.carrier||null,insuranceType:row.insurance_type||null,finalPremium:row.final_premium,startDate:row.start_date||null,expireDate:row.expire_date||null,attachmentCount:row.attachment_count??null,policyAttachmentId:row.policy_attachment_id||null},outcome:candidate?'AMORTIZATION_COVERAGE_EVIDENCE_CANDIDATE':'EXCEPTION_REVIEW_REQUIRED',exception_codes:exceptions,can_retain_evidence:true,can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false});
}

// Pure, evidence-only transformation.  Approximate 12-month policies are not
// promoted: only exact whole-month coverage can become a later proposal input.
export function normalizeVerifiedWbsProviderFinal1Insurance({verified,expectedCurrency='USD'}={}){
  requireVerifiedWbsProviderFinal1InsuranceEvidence(verified);
  if(expectedCurrency!=='USD'||verified.accounting_currency!=='USD'||verified.raw_contains_credentials||verified.admission_blockers.length!==0)fail('WBS_FINAL1_INSURANCE_NORMALIZATION_BLOCKED','Insurance evidence has unresolved verification, redaction, or currency blockers.');
  const rows=verified.package.views.list_insurance.rows.map((row,index)=>normalizeRow(row,verified,index));
  if(rows.length===0)fail('WBS_FINAL1_INSURANCE_NORMALIZATION_EMPTY','Insurance evidence must contain at least one signed row.');
  const provenance=deepFreeze({tenant_id:verified.tenant_id,entity_id:verified.entity_id,company_code:verified.company_code,company_mapping_hash:verified.company_mapping_hash,company_mapping_authority:'PACKAGE_SCOPE_ONLY_SERVER_DECISION_REQUIRED',snapshot_id:verified.snapshot_id,source_surface:{database:'wb_insurance',table:'insurance_data',stable_keys:['id','policy_id']},source_row_count:rows.length,currency:'USD',currency_authority:'REFS_BUSINESS_OWNER_CONFIRMED_CURRENCY'});
  return deepFreeze({status:'NORMALIZED_FINAL1_INSURANCE_EVIDENCE_PLAN',format:'WBS_PROVIDER_FINAL1_NORMALIZED_INSURANCE_V1',provenance,plan_hash:canonicalRequestHash({provenance,row_hashes:rows.map(row=>row.raw_row_hash)}),evidence_rows:rows,candidate_rows:rows.filter(row=>row.outcome==='AMORTIZATION_COVERAGE_EVIDENCE_CANDIDATE'),exception_rows:rows.filter(row=>row.outcome==='EXCEPTION_REVIEW_REQUIRED'),required_next_controls:['persist immutable source evidence','controller-confirm whole-month coverage','approved account and dimension mapping','separate AI proposal authorization'],can_persist_evidence:true,can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false});
}
