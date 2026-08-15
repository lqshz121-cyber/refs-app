import {createHash} from 'node:crypto';
import {canonicalRequestBody,canonicalRequestHash} from './request-hash.mjs';
import {WbsSignedDeliveryAdmissionError} from './wbs-signed-delivery-admission.mjs';
import {requireVerifiedWbsProviderFinal1Evidence} from './wbs-provider-final1-delivery.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const CURRENCY=/^[A-Z]{3}$/;
const DATE=/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const freeze=value=>Object.freeze(value);
const deepFreeze=value=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
const canonical=value=>Buffer.from(canonicalRequestBody(value),'utf8');
const hash=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;
const bare=value=>typeof value==='string'&&value.startsWith('sha256:')?value.slice(7):value;
const fail=(code,message)=>{throw new WbsSignedDeliveryAdmissionError(code,message);};
const text=value=>typeof value==='string'?value.trim():'';
const optionalText=value=>text(value)||null;
const optionalDate=value=>value==null||value===''?null:(DATE.test(value)?value:fail('WBS_FINAL1_NORMALIZATION_ROW_INVALID','A supplied payable date must be ISO date or UTC timestamp.'));
const requiredUuid=(value,label)=>{if(!UUID.test(value||''))fail('WBS_FINAL1_NORMALIZATION_ROW_INVALID',`${label} must be a UUID.`);return value;};

function requireExpectedCurrency(expectedCurrency){
  if(!CURRENCY.test(expectedCurrency||''))fail('WBS_FINAL1_NORMALIZATION_CURRENCY_AUTHORITY_REQUIRED','An independently supplied exact ISO currency is required.');
  return expectedCurrency;
}

function requireVerifiedFinal1(verified){
  if(!object(verified)||verified.status!=='VERIFIED_FINAL1_EVIDENCE_ONLY'||verified.format!=='WBS_PROVIDER_FINAL1'||verified.signature_verified!==true||verified.can_admit!==false||verified.can_create_draft!==false||verified.can_review!==false||verified.can_approve!==false||verified.can_post!==false||!UUID.test(verified.tenant_id||'')||!UUID.test(verified.entity_id||'')||!text(verified.company_code)||!UUID.test(verified.snapshot_id||'')||!HASH.test(verified.package_hash||'')||!HASH.test(verified.raw_package_hash||'')||!object(verified.package))fail('WBS_FINAL1_NORMALIZATION_VERIFIED_INPUT_REQUIRED','A verified Final-1 evidence result is required.');
  const pkg=verified.package,view=pkg.views?.list_payables;
  const unsigned=Object.fromEntries(Object.entries(pkg).filter(([key])=>key!=='package_hash'&&key!=='detached_signature'));
  if(pkg.snapshot_id!==verified.snapshot_id||pkg.company_key!==verified.company_code||`sha256:${bare(pkg.package_hash)}`!==verified.package_hash||`sha256:${bare(pkg.package_hash)}`!==hash(canonical(unsigned))||!object(view)||!Array.isArray(view.rows)||!Number.isSafeInteger(view.row_count)||view.row_count!==view.rows.length||`sha256:${bare(view.content_hash)}`!==hash(canonical(view.rows)))fail('WBS_FINAL1_NORMALIZATION_TAMPERED','The verified Final-1 package changed after signature verification.');
  return freeze({view});
}

function normalizedRow(row,{verified,expectedCurrency,currencyAuthority}){
  if(!object(row)||row.company_code!==verified.company_code||(row.currency!=null&&row.currency!==''&&row.currency!==expectedCurrency))fail('WBS_FINAL1_NORMALIZATION_SCOPE_OR_CURRENCY_MISMATCH','Every payable row must retain the verified company scope; any Provider-supplied currency must match the independently approved accounting currency.');
  const apGuId=requiredUuid(row.ap_guid,'ap_guid'),rawRow=deepFreeze(structuredClone(row)),rawRowHash=hash(canonical(rawRow));
  return freeze({
    source_system:'WBS',source_module:'BGDATA.payable',source_record_id:apGuId,
    source_version:`final1:${verified.snapshot_id}:${bare(rawRowHash).slice(0,16)}`,
    raw_row:rawRow,raw_row_hash:rawRowHash,
    provider_package_hash:verified.package_hash,provider_raw_package_hash:verified.raw_package_hash,
    provider_snapshot_id:verified.snapshot_id,provider_company_code:verified.company_code,
    currency:expectedCurrency,currency_authority:currencyAuthority,
    normalized:freeze({
      apGuId,apLongId:optionalText(row.ap_long_id),apType:optionalText(row.ap_type),amount:optionalText(row.amount),invoiceNo:optionalText(row.invoice_no),
      invoiceDate:optionalDate(row.invoice_date),incurredDate:optionalDate(row.incurred_date),postingDate:optionalDate(row.posting_date),clearDate:optionalDate(row.clear_date),checkNo:optionalText(row.check_no),checkDate:optionalDate(row.check_date),
      vendorRef:optionalText(row.vendor_no),vendorName:optionalText(row.vendor_name),projectRef:optionalText(row.project_guid),projectCode:optionalText(row.pj_code),projectName:optionalText(row.pj_name),
      businessId:optionalText(row.business_id),journalNo:optionalText(row.journal_no),payStatus:optionalText(row.pay_status),reviewStatus:optionalText(row.review_status),description:optionalText(row.description),currency:expectedCurrency
    }),
    outcome:'STAGING_REVIEW_REQUIRED',exception_codes:freeze(['WBS_PAYABLE_ATTACHMENT_REQUIRED','WBS_PAYABLE_MAPPING_REVIEW_REQUIRED']),
    can_create_draft:false,can_review:false,can_approve:false,can_post:false
  });
}

// Pure boundary transformation: no kernel, persistence, Draft, or workflow command.
export function normalizeVerifiedWbsProviderFinal1Payables({verified,expectedCurrency}={}){
  requireVerifiedWbsProviderFinal1Evidence(verified);
  const currency=requireExpectedCurrency(expectedCurrency),{view}=requireVerifiedFinal1(verified);
  if(verified.raw_contains_credentials===true||!Array.isArray(verified.admission_blockers)||verified.admission_blockers.length!==0||verified.accounting_currency!==currency||!['PROVIDER_SIGNED','REFS_BUSINESS_OWNER_CONFIRMED'].includes(verified.currency_authority))fail('WBS_FINAL1_NORMALIZATION_ADMISSION_BLOCKED','Final-1 evidence has unresolved provider-verification blockers or differs from the approved accounting currency.');
  const currencyAuthority=verified.currency_signed===true?'PROVIDER_SIGNED_CURRENCY':'REFS_BUSINESS_OWNER_CONFIRMED_CURRENCY';
  const ids=new Set(),rows=[];
  for(const row of view.rows){
    const normalized=normalizedRow(row,{verified,expectedCurrency:currency,currencyAuthority}),key=normalized.source_record_id.toLowerCase();
    if(ids.has(key))fail('WBS_FINAL1_NORMALIZATION_DUPLICATE_SOURCE','Final-1 Payables contains a duplicate source record.');
    ids.add(key);rows.push(normalized);
  }
  if(rows.length===0)fail('WBS_FINAL1_NORMALIZATION_EMPTY','Final-1 Payables must contain at least one verified row.');
  const provenance=freeze({tenant_id:verified.tenant_id,entity_id:verified.entity_id,company_code:verified.company_code,snapshot_id:verified.snapshot_id,provider_package_hash:verified.package_hash,provider_raw_package_hash:verified.raw_package_hash,source_row_count:rows.length,currency,currency_authority:currencyAuthority});
  return freeze({status:'NORMALIZED_FINAL1_PAYABLE_STAGING_PLAN',format:'WBS_PROVIDER_FINAL1_NORMALIZED_PAYABLES_V1',provenance,plan_hash:canonicalRequestHash({provenance,row_hashes:rows.map(row=>row.raw_row_hash)}),staging_rows:freeze(rows),exception_rows:freeze([]),required_next_controls:freeze(['persist immutable staging evidence','exact attachment binding','approved mapping review','separate standard REFS Draft workflow']),can_persist_staging:true,can_create_draft:false,can_review:false,can_approve:false,can_post:false});
}
