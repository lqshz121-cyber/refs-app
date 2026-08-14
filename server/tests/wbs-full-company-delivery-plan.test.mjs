import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {assertWbsFullCompanyDeliveryPlanReady,buildWbsFullCompanyDeliveryPlan,inspectWbsFullCompanyDeliveryPlan} from '../runtime/wbs-full-company-delivery-plan.mjs';

const tenant='11111111-1111-4111-8111-111111111111',entity='22222222-2222-4222-8222-222222222222';
const withHash=(value,field)=>({...value,[field]:canonicalRequestHash(value)});
function fixture(){
  const company={wbs_company_id:'176',company_code:'WBPA',legal_name:'Wan Pacific Real Estate Development LLC',display_name:'Wan Pacific',active_status:'ACTIVE',base_currency:'USD',supported_domains:['PAYABLES','BANK_STATEMENTS'],source_version:'company-master-v1',source_hash:`sha256:${'1'.repeat(64)}`};
  const catalog=withHash({catalog_version:'catalog-v1',generated_at:'2026-08-15T00:00:00.000Z',provider_environment:'PRODUCTION',record_count:1,companies:[company]},'catalog_sha256');
  const mapping=withHash({tenant_id:tenant,refs_entity_id:entity,company_code:'WBPA',base_currency:'USD',effective_from:'2026-01-01',effective_to:null,approval_status:'APPROVED',approved_by:'business-owner',approved_at:'2026-08-15T00:05:00.000Z',mapping_version:'mapping-v1'},'mapping_hash');
  const unit=domain=>({delivery_unit_id:`WBPA-${domain}-2026-H1`,refs_entity_id:entity,company_code:'WBPA',domain,date_from:'2026-01-01',date_to:'2026-06-30',mapping_version:mapping.mapping_version,mapping_hash:mapping.mapping_hash,expected_artifacts:['receipt.json','request.raw','response.raw','package.json'],require_provider_scope_echo:true});
  const plan={schema_version:'REFS_WBS_FULL_COMPANY_DELIVERY_PLAN_V1',tenant_id:tenant,plan_version:'plan-v1',generated_at:'2026-08-15T00:10:00.000Z',required_coverage:{date_from:'2026-01-01',date_to:'2026-06-30',domains:['PAYABLES','BANK_STATEMENTS']},trust:{issuer:'wbs-provider',key_id:'wbs-2026-08',algorithm:'Ed25519',fingerprint_sha256:`sha256:${'2'.repeat(64)}`,status:'PINNED'},catalog,mappings:[mapping],delivery_units:[unit('PAYABLES'),unit('BANK_STATEMENTS')]};
  return withHash(plan,'plan_hash');
}

test('a complete full-company plan binds every active company, entity, domain, date and four-artifact bundle',()=>{
  const result=assertWbsFullCompanyDeliveryPlanReady(fixture());
  assert.deepEqual({status:result.status,companies:result.company_count,mapped:result.mapped_company_count,units:result.delivery_unit_count,admit:result.can_admit,draft:result.can_create_draft,post:result.can_post},{status:'READY_TO_RECEIVE_PROVIDER_SIGNED_DELIVERIES',companies:1,mapped:1,units:2,admit:false,draft:false,post:false});
});

test('missing trust, company mapping, domain coverage, or exact scope remains incomplete',()=>{
  const base=fixture(),cases=[
    {...base,trust:{...base.trust,status:'PENDING_INDEPENDENT_DELIVERY',fingerprint_sha256:null}},
    {...base,mappings:[],delivery_units:[]},
    {...base,delivery_units:base.delivery_units.slice(0,1)}
  ];
  for(const changed of cases){changed.plan_hash=canonicalRequestHash(Object.fromEntries(Object.entries(changed).filter(([key])=>key!=='plan_hash')));const result=inspectWbsFullCompanyDeliveryPlan(changed);assert.equal(result.status,'INCOMPLETE');assert(result.blockers.length>0);assert.throws(()=>assertWbsFullCompanyDeliveryPlanReady(changed),error=>error.code==='WBS_FULL_COMPANY_PLAN_INCOMPLETE');}
  const wrongScope=fixture();wrongScope.delivery_units[0]={...wrongScope.delivery_units[0],refs_entity_id:'33333333-3333-4333-8333-333333333333'};wrongScope.plan_hash=canonicalRequestHash(Object.fromEntries(Object.entries(wrongScope).filter(([key])=>key!=='plan_hash')));assert.throws(()=>inspectWbsFullCompanyDeliveryPlan(wrongScope),error=>error.code==='WBS_FULL_COMPANY_SCOPE_INVALID');
});

test('catalog, mapping and plan hashes plus non-overlapping full coverage are mandatory',()=>{
  const badCatalog=fixture();badCatalog.catalog.companies[0].display_name='Tampered';badCatalog.plan_hash=canonicalRequestHash(Object.fromEntries(Object.entries(badCatalog).filter(([key])=>key!=='plan_hash')));assert.throws(()=>inspectWbsFullCompanyDeliveryPlan(badCatalog),error=>error.code==='WBS_FULL_COMPANY_CATALOG_HASH_MISMATCH');
  const badMapping=fixture();badMapping.mappings[0].approved_by='attacker';badMapping.plan_hash=canonicalRequestHash(Object.fromEntries(Object.entries(badMapping).filter(([key])=>key!=='plan_hash')));assert.throws(()=>inspectWbsFullCompanyDeliveryPlan(badMapping),error=>error.code==='WBS_FULL_COMPANY_MAPPING_HASH_MISMATCH');
  const overlap=fixture(),first=overlap.delivery_units[0];overlap.delivery_units.push({...first,delivery_unit_id:'WBPA-PAYABLES-OVERLAP',date_from:'2026-06-01'});overlap.plan_hash=canonicalRequestHash(Object.fromEntries(Object.entries(overlap).filter(([key])=>key!=='plan_hash')));const inspected=inspectWbsFullCompanyDeliveryPlan(overlap);assert(inspected.blockers.some(item=>item.code==='DELIVERY_RANGE_OVERLAP'));
});

test('the builder expands every active mapped company and required domain into exact scoped delivery units',()=>{
  const expected=fixture(),built=buildWbsFullCompanyDeliveryPlan({tenantId:expected.tenant_id,planVersion:'plan-built-v1',generatedAt:'2026-08-15T01:00:00.000Z',requiredCoverage:expected.required_coverage,trust:expected.trust,catalog:expected.catalog,mappings:expected.mappings});
  assert.equal(built.delivery_units.length,2);assert.deepEqual(built.delivery_units.map(unit=>[unit.company_code,unit.refs_entity_id,unit.domain,unit.date_from,unit.date_to]),[['WBPA',entity,'PAYABLES','2026-01-01','2026-06-30'],['WBPA',entity,'BANK_STATEMENTS','2026-01-01','2026-06-30']]);
  assert.equal(assertWbsFullCompanyDeliveryPlanReady(built).status,'READY_TO_RECEIVE_PROVIDER_SIGNED_DELIVERIES');
});
