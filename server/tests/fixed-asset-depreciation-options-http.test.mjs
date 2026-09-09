import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {FIXED_ASSET_DEPRECIATION_READINESS,validFixedAssetDepreciationOptions} from '../api/fixed-asset-depreciation-options-contract.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),assetId=randomUUID(),periodId=randomUUID(),hash='sha256:'+'a'.repeat(64);
const row={
 schema_version:'FIXED_ASSET_DEPRECIATION_OPTIONS_V2',tenant_id:tenantId,entity_id:entityId,asset_id:assetId,asset_tag:'Building 1',evidence_status:'ACTIVE',register_evidence_hash:hash,
 member_trace:{project_ref:'PROJECT-1',property_ref:'PROPERTY-1',allocation_basis:'SOURCE_DIMENSIONED'},currency:'USD',cost_basis:'25000.0000',salvage_value:'1000.0000',asset_account_code:'150100',accumulated_depreciation_account_code:'159100',depreciation_expense_account_code:'680100',
 period:{period_id:periodId,period_code:'2026-07',starts_on:'2026-07-01',ends_on:'2026-07-31',status:'OPEN'},
 source:{source_document_id:randomUUID(),source_document_version:1,source_payload_hash:hash,source_document_line_id:randomUUID(),source_line_snapshot_hash:hash,original_evidence_id:randomUUID(),original_evidence_hash:hash},
 acquisition:{binding_id:randomUUID(),journal_entry_id:randomUUID()},policy:{policy_snapshot_id:randomUUID(),policy_snapshot_hash:hash,policy_snapshot_version:1,policy_version:1},post_impairment_policy:null,
 schedule:{schedule_snapshot_hash:hash,schedule_basis:'ORIGINAL_REGISTER',revised_period_number:null,expected_period_depreciation:'200.0000',expected_accumulated_depreciation:'200.0000',expected_prior_accumulated_depreciation:'0.0000'},
 actual_posted_cost:'25000.0000',actual_prior_accumulated_depreciation:'0.0000',acquisition_posted:true,impairment_recorded:false,disposal_recorded:false,readiness_status:'READY',pending_journals:[],more_pending_journals:false,requires_command_validation:true
};
const postPolicy={schema_version:'FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY_V1',policy_id:randomUUID(),policy_evidence_hash:hash,status:'INDEPENDENTLY_REVIEWED',fixed_asset_register_evidence_id:assetId,impairment_assessment_evidence_id:randomUUID(),impairment_assessment_hash:hash,impairment_journal_entry_id:randomUUID(),impairment_posting_snapshot_hash:hash,effective_period_id:periodId,effective_from:'2026-08-01',convention:'NEXT_PERIOD_FULL_MONTH',remaining_useful_life_months:110,posted_cost_balance:'25000.0000',prior_accumulated_depreciation:'2000.0000',posted_accumulated_impairment:'5000.0000',revised_carrying_value:'18000.0000',salvage_value:'1000.0000',revised_depreciable_basis:'17000.0000',regular_period_amount:'154.5455',final_period_amount:'154.5405',reviewed_by:'policy-reviewer',reviewed_at:'2026-07-31T12:00:00Z',review_reason:'Independently reviewed revised useful life and amounts.'};
const revised={...row,period:{...row.period,period_code:'2026-08',starts_on:'2026-08-01',ends_on:'2026-08-31'},post_impairment_policy:postPolicy,schedule:{...row.schedule,schedule_basis:'POST_IMPAIRMENT_REVISED',revised_period_number:1,expected_period_depreciation:'154.5455',expected_accumulated_depreciation:'2154.5455',expected_prior_accumulated_depreciation:'2000.0000'},actual_prior_accumulated_depreciation:'2000.0000',impairment_recorded:true};
const request={method:'GET',url:`/api/v1/entities/${entityId}/fixed-assets/register/${assetId}/depreciation-options?periodId=${periodId}`};
const setup=(result=row)=>{const calls=[];return {calls,api:createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({readFixedAssetDepreciationOptions:async args=>{calls.push(args);return result;}})})};};

test('depreciation options return canonical scoped evidence and all readiness states',async()=>{
 const {api,calls}=setup();const response=await api(request);assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls,[{tenantId,entityId,assetId,periodId}]);assert.deepEqual(response.body.data,row);
 const blocked={
  BLOCKED_ASSET_INACTIVE:{evidence_status:'INACTIVE'},BLOCKED_PERIOD_NOT_OPEN:{period:{...row.period,status:'CLOSED'}},BLOCKED_ACQUISITION_NOT_POSTED:{source:null,acquisition:null,acquisition_posted:false},BLOCKED_ACQUISITION_EVIDENCE:{},
  BLOCKED_POST_IMPAIRMENT_POLICY_REQUIRED:{impairment_recorded:true},BLOCKED_ASSET_DISPOSED:{disposal_recorded:true},BLOCKED_NOT_DUE:{schedule:{...row.schedule,expected_period_depreciation:'0.0000',expected_accumulated_depreciation:'0.0000'}},
  BLOCKED_COST_RECONCILIATION:{actual_posted_cost:'24999.0000'},BLOCKED_PRIOR_DEPRECIATION_RECONCILIATION:{actual_prior_accumulated_depreciation:'100.0000'},BLOCKED_ALREADY_POSTED:{}
 };
 assert.deepEqual(Object.keys(blocked).sort(),FIXED_ASSET_DEPRECIATION_READINESS.filter(value=>value!=='READY').sort());
 for(const [readiness_status,patch] of Object.entries(blocked)){const value={...row,...patch,readiness_status};assert.equal(validFixedAssetDepreciationOptions(value,{tenantId,entityId,assetId,periodId}),true,readiness_status);assert.equal((await setup(value).api(request)).status,200,readiness_status);}
});

test('reviewed post-impairment policy permits an exact revised schedule',async()=>{
 assert.equal(validFixedAssetDepreciationOptions(revised,{tenantId,entityId,assetId,periodId}),true);
 assert.equal((await setup(revised).api(request)).status,200);
});

test('depreciation options reject request mutations and malformed or cross-scope evidence',async()=>{
 const {api,calls}=setup();for(const patch of [{body:{}},{headers:{'if-match':'"1"'}},{headers:{'idempotency-key':'unused'}},{url:request.url+'&tenantId=other'},{url:request.url.replace(periodId,'missing')}])assert.equal((await api({...request,...patch})).status,400);assert.equal(calls.length,0);
 const malformed=[null,{...row,tenant_id:randomUUID()},{...row,asset_id:randomUUID()},{...row,schedule:null},{...row,readiness_status:'READY',impairment_recorded:true},{...row,readiness_status:'READY',actual_posted_cost:'24999.0000'},{...row,readiness_status:'READY',actual_prior_accumulated_depreciation:'100.0000'},{...row,source:null},{...row,pending_journals:[{journal_entry_id:randomUUID(),period_id:randomUUID(),journal_number:'D',journal_date:'2026-07-31',status:'DRAFT',revision:0}]},
  {...revised,post_impairment_policy:{...postPolicy,revised_carrying_value:'18001.0000'}},{...revised,post_impairment_policy:{...postPolicy,regular_period_amount:'154.5454'}},{...revised,post_impairment_policy:{...postPolicy,reviewed_at:'1'}},{...revised,schedule:{...revised.schedule,expected_period_depreciation:'154.5454'}},{...revised,schedule:{...revised.schedule,revised_period_number:null}},{...revised,post_impairment_policy:{...postPolicy,effective_from:'2026-09-01'}}];
 for(const value of malformed)assert.equal((await setup(value).api(request)).status,502);
});
