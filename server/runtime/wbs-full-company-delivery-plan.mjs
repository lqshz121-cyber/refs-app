import {canonicalRequestHash} from './request-hash.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMPANY=/^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const CURRENCY=/^[A-Z]{3}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const DOMAINS=new Set(['PAYABLES','AR','BANK_STATEMENTS','AUTOREC','JOURNALS','COST','INSURANCE','PROPERTY_OPERATIONS']);
const ARTIFACTS=Object.freeze(['receipt.json','request.raw','response.raw','package.json']);

export class WbsFullCompanyDeliveryPlanError extends Error{
  constructor(code,message,details=[]){super(message);this.name='WbsFullCompanyDeliveryPlanError';this.code=code;this.details=details;}
}
const fail=(code,message,details)=>{throw new WbsFullCompanyDeliveryPlanError(code,message,details);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const exactKeys=(value,keys,label)=>{
  if(!object(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))fail('WBS_FULL_COMPANY_PLAN_INVALID',`${label} has an invalid shape.`);
};
const utc=value=>typeof value==='string'&&value.endsWith('Z')&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;
const date=value=>{
  if(typeof value!=='string'||!DATE.test(value))return false;
  const parsed=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
};
const day=value=>Math.floor(Date.parse(`${value}T00:00:00.000Z`)/86400000);
const unique=(values,label)=>{if(new Set(values).size!==values.length)fail('WBS_FULL_COMPANY_PLAN_INVALID',`${label} must be unique.`);};
const normalizedHash=(value,field)=>canonicalRequestHash(Object.fromEntries(Object.entries(value).filter(([key])=>key!==field)));

function normalizeCompany(value,index){
  exactKeys(value,['wbs_company_id','company_code','legal_name','display_name','active_status','base_currency','supported_domains','source_version','source_hash'],`companies[${index}]`);
  if(!TOKEN.test(value.wbs_company_id)||!COMPANY.test(value.company_code)||!text(value.legal_name)||!text(value.display_name)||!['ACTIVE','INACTIVE','CLOSED'].includes(value.active_status)||!CURRENCY.test(value.base_currency)||!Array.isArray(value.supported_domains)||value.supported_domains.length===0||value.supported_domains.some(domain=>!DOMAINS.has(domain))||!TOKEN.test(value.source_version)||!HASH.test(value.source_hash))fail('WBS_FULL_COMPANY_PLAN_INVALID',`companies[${index}] contains an invalid company fact.`);
  unique(value.supported_domains,`companies[${index}].supported_domains`);
  return Object.freeze({...value,supported_domains:Object.freeze([...value.supported_domains].sort())});
}

function normalizeCatalog(value){
  exactKeys(value,['catalog_version','generated_at','provider_environment','record_count','catalog_sha256','companies'],'catalog');
  if(!TOKEN.test(value.catalog_version)||!utc(value.generated_at)||value.provider_environment!=='PRODUCTION'||!Number.isInteger(value.record_count)||value.record_count<1||!HASH.test(value.catalog_sha256)||!Array.isArray(value.companies)||value.companies.length!==value.record_count)fail('WBS_FULL_COMPANY_PLAN_INVALID','The production company catalog is incomplete.');
  if(normalizedHash(value,'catalog_sha256')!==value.catalog_sha256)fail('WBS_FULL_COMPANY_CATALOG_HASH_MISMATCH','The company catalog hash does not bind the exact catalog.');
  const companies=value.companies.map(normalizeCompany);
  unique(companies.map(company=>company.company_code),'company codes');
  unique(companies.map(company=>company.wbs_company_id),'WBS company ids');
  const normalized={...value,companies};
  return Object.freeze(normalized);
}

function normalizeMapping(value,index,tenantId,companies){
  exactKeys(value,['tenant_id','refs_entity_id','company_code','base_currency','effective_from','effective_to','approval_status','approved_by','approved_at','mapping_version','mapping_hash'],`mappings[${index}]`);
  if(value.tenant_id!==tenantId||!UUID.test(value.refs_entity_id)||!COMPANY.test(value.company_code)||!CURRENCY.test(value.base_currency)||!date(value.effective_from)||(value.effective_to!==null&&(!date(value.effective_to)||day(value.effective_to)<day(value.effective_from)))||value.approval_status!=='APPROVED'||!text(value.approved_by,128)||!utc(value.approved_at)||!TOKEN.test(value.mapping_version)||!HASH.test(value.mapping_hash))fail('WBS_FULL_COMPANY_PLAN_INVALID',`mappings[${index}] is not an exact approved mapping.`);
  const company=companies.get(value.company_code);
  if(!company||company.active_status!=='ACTIVE'||company.base_currency!==value.base_currency)fail('WBS_FULL_COMPANY_MAPPING_INVALID',`mappings[${index}] does not match one active catalog company.`);
  if(normalizedHash(value,'mapping_hash')!==value.mapping_hash)fail('WBS_FULL_COMPANY_MAPPING_HASH_MISMATCH',`mappings[${index}] hash is invalid.`);
  return Object.freeze({...value});
}

function normalizeUnit(value,index,mappings,companies,required){
  exactKeys(value,['delivery_unit_id','refs_entity_id','company_code','domain','date_from','date_to','mapping_version','mapping_hash','expected_artifacts','require_provider_scope_echo'],`delivery_units[${index}]`);
  if(!TOKEN.test(value.delivery_unit_id)||!UUID.test(value.refs_entity_id)||!COMPANY.test(value.company_code)||!DOMAINS.has(value.domain)||!date(value.date_from)||!date(value.date_to)||day(value.date_to)<day(value.date_from)||!TOKEN.test(value.mapping_version)||!HASH.test(value.mapping_hash)||!Array.isArray(value.expected_artifacts)||value.require_provider_scope_echo!==true)fail('WBS_FULL_COMPANY_PLAN_INVALID',`delivery_units[${index}] is invalid.`);
  if(value.date_from<required.date_from||value.date_to>required.date_to)fail('WBS_FULL_COMPANY_COVERAGE_INVALID',`delivery_units[${index}] falls outside the required range.`);
  if(JSON.stringify([...value.expected_artifacts].sort())!==JSON.stringify([...ARTIFACTS].sort()))fail('WBS_FULL_COMPANY_ARTIFACTS_INVALID',`delivery_units[${index}] must require the exact four signed artifacts.`);
  const mapping=mappings.get(value.company_code),company=companies.get(value.company_code);
  if(!mapping||mapping.refs_entity_id!==value.refs_entity_id||mapping.mapping_version!==value.mapping_version||mapping.mapping_hash!==value.mapping_hash)fail('WBS_FULL_COMPANY_SCOPE_INVALID',`delivery_units[${index}] is not bound to its approved entity mapping.`);
  if(!company.supported_domains.includes(value.domain)||!required.domains.includes(value.domain))fail('WBS_FULL_COMPANY_DOMAIN_INVALID',`delivery_units[${index}] requests an unsupported domain.`);
  return Object.freeze({...value,expected_artifacts:Object.freeze([...value.expected_artifacts].sort())});
}

function coverageBlockers(activeCompanies,units,required){
  const blockers=[];
  for(const company of activeCompanies){
    for(const domain of required.domains){
      if(!company.supported_domains.includes(domain)){blockers.push({code:'DOMAIN_NOT_AVAILABLE',company_code:company.company_code,domain});continue;}
      const ranges=units.filter(unit=>unit.company_code===company.company_code&&unit.domain===domain).sort((a,b)=>a.date_from.localeCompare(b.date_from));
      if(ranges.length===0){blockers.push({code:'DELIVERY_UNIT_MISSING',company_code:company.company_code,domain});continue;}
      let next=day(required.date_from);
      for(const range of ranges){
        const start=day(range.date_from),end=day(range.date_to);
        if(start<next){blockers.push({code:'DELIVERY_RANGE_OVERLAP',company_code:company.company_code,domain,date_from:range.date_from});break;}
        if(start>next){blockers.push({code:'DELIVERY_RANGE_GAP',company_code:company.company_code,domain,date_from:new Date(next*86400000).toISOString().slice(0,10),date_to:new Date((start-1)*86400000).toISOString().slice(0,10)});break;}
        next=end+1;
      }
      if(next<=day(required.date_to)&&!blockers.some(item=>item.company_code===company.company_code&&item.domain===domain))blockers.push({code:'DELIVERY_RANGE_GAP',company_code:company.company_code,domain,date_from:new Date(next*86400000).toISOString().slice(0,10),date_to:required.date_to});
    }
  }
  return blockers;
}

export function inspectWbsFullCompanyDeliveryPlan(value){
  exactKeys(value,['schema_version','tenant_id','plan_version','generated_at','required_coverage','trust','catalog','mappings','delivery_units','plan_hash'],'plan');
  if(value.schema_version!=='REFS_WBS_FULL_COMPANY_DELIVERY_PLAN_V1'||!UUID.test(value.tenant_id)||!TOKEN.test(value.plan_version)||!utc(value.generated_at)||!HASH.test(value.plan_hash))fail('WBS_FULL_COMPANY_PLAN_INVALID','The delivery plan header is invalid.');
  if(normalizedHash(value,'plan_hash')!==value.plan_hash)fail('WBS_FULL_COMPANY_PLAN_HASH_MISMATCH','The delivery plan hash does not bind the exact plan.');
  exactKeys(value.required_coverage,['date_from','date_to','domains'],'required_coverage');
  if(!date(value.required_coverage.date_from)||!date(value.required_coverage.date_to)||day(value.required_coverage.date_to)<day(value.required_coverage.date_from)||!Array.isArray(value.required_coverage.domains)||value.required_coverage.domains.length===0||value.required_coverage.domains.some(domain=>!DOMAINS.has(domain)))fail('WBS_FULL_COMPANY_PLAN_INVALID','The required coverage is invalid.');
  unique(value.required_coverage.domains,'required coverage domains');
  exactKeys(value.trust,['issuer','key_id','algorithm','fingerprint_sha256','status'],'trust');
  if(!TOKEN.test(value.trust.issuer)||!TOKEN.test(value.trust.key_id)||value.trust.algorithm!=='Ed25519'||(value.trust.fingerprint_sha256!==null&&!HASH.test(value.trust.fingerprint_sha256))||!['PENDING_INDEPENDENT_DELIVERY','PINNED'].includes(value.trust.status))fail('WBS_FULL_COMPANY_PLAN_INVALID','The provider trust declaration is invalid.');
  const catalog=normalizeCatalog(value.catalog),companies=new Map(catalog.companies.map(company=>[company.company_code,company])),activeCompanies=catalog.companies.filter(company=>company.active_status==='ACTIVE');
  if(!Array.isArray(value.mappings)||!Array.isArray(value.delivery_units))fail('WBS_FULL_COMPANY_PLAN_INVALID','Mappings and delivery units must be arrays.');
  const mappings=value.mappings.map((mapping,index)=>normalizeMapping(mapping,index,value.tenant_id,companies));
  unique(mappings.map(mapping=>mapping.company_code),'mapped company codes');unique(mappings.map(mapping=>mapping.refs_entity_id),'mapped REFS entity ids');
  const mappingByCompany=new Map(mappings.map(mapping=>[mapping.company_code,mapping]));
  const units=value.delivery_units.map((unit,index)=>normalizeUnit(unit,index,mappingByCompany,companies,value.required_coverage));
  unique(units.map(unit=>unit.delivery_unit_id),'delivery unit ids');
  const blockers=[];
  if(value.trust.status!=='PINNED')blockers.push({code:'PROVIDER_TRUST_NOT_PINNED'});
  for(const company of activeCompanies)if(!mappingByCompany.has(company.company_code))blockers.push({code:'ACTIVE_COMPANY_MAPPING_MISSING',company_code:company.company_code});
  blockers.push(...coverageBlockers(activeCompanies,units,value.required_coverage));
  return Object.freeze({schema_version:value.schema_version,status:blockers.length?'INCOMPLETE':'READY_TO_RECEIVE_PROVIDER_SIGNED_DELIVERIES',tenant_id:value.tenant_id,plan_version:value.plan_version,plan_hash:value.plan_hash,catalog_version:catalog.catalog_version,company_count:catalog.companies.length,active_company_count:activeCompanies.length,mapped_company_count:mappings.length,delivery_unit_count:units.length,required_coverage:Object.freeze({...value.required_coverage,domains:Object.freeze([...value.required_coverage.domains].sort())}),blockers:Object.freeze(blockers.map(item=>Object.freeze(item))),can_admit:false,can_create_draft:false,can_approve:false,can_post:false});
}

export function assertWbsFullCompanyDeliveryPlanReady(value){
  const result=inspectWbsFullCompanyDeliveryPlan(value);
  if(result.status!=='READY_TO_RECEIVE_PROVIDER_SIGNED_DELIVERIES')fail('WBS_FULL_COMPANY_PLAN_INCOMPLETE','The full-company signed delivery plan is incomplete.',result.blockers);
  return result;
}

export function buildWbsFullCompanyDeliveryPlan({tenantId,planVersion,generatedAt,requiredCoverage,trust,catalog,mappings}={}){
  if(!object(requiredCoverage)||!Array.isArray(requiredCoverage.domains)||!object(catalog)||!Array.isArray(catalog.companies)||!Array.isArray(mappings))fail('WBS_FULL_COMPANY_PLAN_INVALID','Catalog, mappings and required coverage are required to build the plan.');
  const mappingByCompany=new Map(mappings.map(mapping=>[mapping.company_code,mapping]));
  const deliveryUnits=[];
  for(const company of catalog.companies.filter(item=>item.active_status==='ACTIVE')){
    const mapping=mappingByCompany.get(company.company_code);
    if(!mapping)continue;
    for(const domain of requiredCoverage.domains){
      if(!company.supported_domains.includes(domain))continue;
      deliveryUnits.push({delivery_unit_id:`${company.company_code}-${domain}-${requiredCoverage.date_from}-${requiredCoverage.date_to}`,refs_entity_id:mapping.refs_entity_id,company_code:company.company_code,domain,date_from:requiredCoverage.date_from,date_to:requiredCoverage.date_to,mapping_version:mapping.mapping_version,mapping_hash:mapping.mapping_hash,expected_artifacts:[...ARTIFACTS],require_provider_scope_echo:true});
    }
  }
  const plan={schema_version:'REFS_WBS_FULL_COMPANY_DELIVERY_PLAN_V1',tenant_id:tenantId,plan_version:planVersion,generated_at:generatedAt,required_coverage:{...requiredCoverage,domains:[...requiredCoverage.domains]},trust:{...trust},catalog:structuredClone(catalog),mappings:structuredClone(mappings),delivery_units:deliveryUnits};
  plan.plan_hash=canonicalRequestHash(plan);
  assertWbsFullCompanyDeliveryPlanReady(plan);
  return Object.freeze(plan);
}

export const WBS_FULL_COMPANY_DELIVERY_DOMAINS=Object.freeze([...DOMAINS]);
export const WBS_FULL_COMPANY_DELIVERY_ARTIFACTS=ARTIFACTS;
