import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {approvedSettingsFixture,entityId,periodId,tenantId} from './helpers/approved-settings-dto-fixture.mjs';
export {approvedSettingsFixture,entityId,periodId,tenantId};

const base=approvedSettingsFixture();
const hash='sha256:'+'a'.repeat(64);

function kernel(result=base){
  const calls=[];const client={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('session_user'))return {rowCount:1,rows:[{session_user:'refs_runtime',current_user:'refs_runtime',is_superuser:false}]};if(sql.includes('refs_bootstrap_context'))return {rowCount:1,rows:[{}]};return {rowCount:1,rows:[{settings:result}]};}};
  return {calls,kernel:new PostgresAccountingKernel({connect:async()=>({...client,release(){}})},{sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(32)})})};
}

test('reads only the server-resolved approved settings snapshot for the exact tenant/entity/period',async()=>{
  const {calls,kernel:reader}=kernel();const dto=await reader.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true});assert.deepEqual(dto,base);assert.equal(Object.isFrozen(dto),true);assert.equal(Object.isFrozen(dto.coa),true);assert.equal(Object.isFrozen(dto.coa.settings),true);
  assert.deepEqual(calls.find(call=>call.sql.includes('refs_read_wbs_ai_approved_entity_period_settings')).args,[tenantId,entityId,periodId]);
});

test('rejects missing read-only intent, invalid scope, and any unsafe server result without a caller fallback',async()=>{
  const {kernel:reader}=kernel();
  for(const args of [{tenantId,entityId,periodId,readOnly:false},{tenantId:'bad',entityId,periodId,readOnly:true}])await assert.rejects(reader.readApprovedWbsAiEntityPeriodSettings(args),error=>error.code==='WBS_AI_SETTINGS_REQUEST_INVALID');
  const {kernel:wrongScope}=kernel({...base,entity_id:'00000000-0000-4000-8000-000000000002'});
  await assert.rejects(wrongScope.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true}),error=>error.code==='WBS_AI_APPROVED_SETTINGS_INVALID');
  for(const unsafe of [{...base,raw_package:{}},{...base,authorization:'Bearer value'},{...base,coa:{...base.coa,credential:'nope'}},{...base,period_status:'UNKNOWN'}]){
    const {kernel:unsafeReader}=kernel(unsafe);await assert.rejects(unsafeReader.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true}),error=>error.code==='WBS_AI_APPROVED_SETTINGS_INVALID');
  }
  for(const unsafe of [{...base,coa:{...base.coa,version:0}},{...base,coa:{...base.coa,snapshot_hash:'sha256:bad'}},{...base,coa:{...base.coa,approval_status:'DRAFT'}},{...base,coa:{...base.coa,entity_id:'00000000-0000-4000-8000-000000000002'}},{...base,coa:{...base.coa,settings:{...base.coa.settings,raw_package:{}}}}]){
    const {kernel:unsafeReader}=kernel(unsafe);await assert.rejects(unsafeReader.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true}),error=>error.code==='WBS_AI_APPROVED_SETTINGS_INVALID');
  }
  for(const unsafe of [
    {...base,report_mapping:{...base.report_mapping,settings:{...base.report_mapping.settings,account_mappings:base.report_mapping.settings.account_mappings.map((mapping,index)=>index===0?{...mapping,account_code:'MISMATCH'}:mapping)}}},
    {...base,approval_thresholds:{...base.approval_thresholds,settings:{...base.approval_thresholds.settings,approval_levels:base.approval_thresholds.settings.approval_levels.map((level,index)=>index===0?{...level,sod_constraints:['banana']}:level)}}},
    {...base,approval_thresholds:{...base.approval_thresholds,settings:{...base.approval_thresholds.settings,approval_levels:base.approval_thresholds.settings.approval_levels.map((level,index)=>index===0?{...level,minimum_amount:'100.0000',maximum_amount:'20.0000'}:level)}}},
    {...base,period_start:'2026-02-31'},
    {...base,coa:{...base.coa,settings:{...base.coa.settings,accounts:base.coa.settings.accounts.map((account,index)=>index===0?{...account,effective_from:'2026-08-01'}:account)}}},
    {...base,intercompany:{...base.intercompany,settings:{enabled:true,clearing_account_role:'INTERCOMPANY_CLEARING',entities:[{company_code:'ICPARTNER',counterparty_entity_id:'11111111-1111-4111-8111-111111111111',counterparty_approval_id:'22222222-2222-4222-8222-222222222222',counterparty_approval_hash:hash,currency:'USD',dimension_requirements:[],due_to_account_role:'BLOCKED',due_from_account_role:'INTERCOMPANY_DUE_FROM',elimination_account_role:'INTERCOMPANY_ELIMINATION',effective_from:'2026-01-01',effective_to:null}]}}},
    {...base,tax:{...base.tax,settings:{...base.tax.settings,coverage_end:'2026-06-30'}}},
    {...base,loan_capitalization_policy:{...base.loan_capitalization_policy,settings:{...base.loan_capitalization_policy.settings,required_evidence:[]}}},
    {...base,loan_capitalization_policy:{...base.loan_capitalization_policy,settings:{...base.loan_capitalization_policy.settings,qualifying_combinations:[{...base.loan_capitalization_policy.settings.qualifying_combinations[0],project_ref:'unknown-project'}]}}},
    {...base,loan_capitalization_policy:{...base.loan_capitalization_policy,settings:{...base.loan_capitalization_policy.settings,qualifying_combinations:[{...base.loan_capitalization_policy.settings.qualifying_combinations[0],asset_ref:'asset-1'}]}}},
    {...base,approval_thresholds:{...base.approval_thresholds,settings:{...base.approval_thresholds.settings,classification_thresholds:base.approval_thresholds.settings.classification_thresholds.filter(row=>row.classification!=='TAX')}}},
    {...base,approval_thresholds:{...base.approval_thresholds,settings:{...base.approval_thresholds.settings,classification_thresholds:[...base.approval_thresholds.settings.classification_thresholds,{...base.approval_thresholds.settings.classification_thresholds[0]}]}}},
    {...base,approval_thresholds:{...base.approval_thresholds,settings:{...base.approval_thresholds.settings,approval_levels:base.approval_thresholds.settings.approval_levels.map((level,index)=>index===1?{...level,workflow:'DRIFT'}:level)}}},
    {...base,approval_thresholds:{...base.approval_thresholds,settings:{...base.approval_thresholds.settings,approval_levels:base.approval_thresholds.settings.approval_levels.map((level,index)=>index===1?{...level,reviewer_role:'AP_PREPARER'}:level)}}},
    {...base,approval_thresholds:{...base.approval_thresholds,settings:{...base.approval_thresholds.settings,approval_levels:base.approval_thresholds.settings.approval_levels.map((level,index)=>index===0?{...level,submitter_role:'OTHER'}:level)}}},
    {...base,approval_thresholds:{...base.approval_thresholds,settings:{...base.approval_thresholds.settings,approval_levels:base.approval_thresholds.settings.approval_levels.map((level,index)=>index===0?{...level,submit_permission:'GL.JE.POST'}:level)}}},
    {...base,coa:{...base.coa,settings:{...base.coa.settings,accounts:base.coa.settings.accounts.map(account=>account.role==='AR'?{...account,account_class:'LIABILITY'}:account)}}},
    {...base,report_mapping:{...base.report_mapping,settings:{...base.report_mapping.settings,account_mappings:base.report_mapping.settings.account_mappings.map(mapping=>mapping.account_role==='ACCUMULATED_DEPRECIATION'?{...mapping,contra:false}:mapping)}}},
    {...base,report_mapping:{...base.report_mapping,settings:{...base.report_mapping.settings,account_mappings:base.report_mapping.settings.account_mappings.map(mapping=>mapping.account_role==='EXPENSE'?{...mapping,statement:'BS'}:mapping)}}},
    {...base,coa:{...base.coa,settings:{...base.coa.settings,accounts:base.coa.settings.accounts.filter(account=>account.role!=='CUSTOMER_DEPOSIT_LIABILITY')}}},
    {...base,coa:{...base.coa,settings:{...base.coa.settings,accounts:[...base.coa.settings.accounts,{...base.coa.settings.accounts.find(account=>account.role==='AP'),account_code:'AP-DUP',effective_from:'2026-01-01'}]}}},
    {...base,coa:{...base.coa,settings:{...base.coa.settings,accounts:[...base.coa.settings.accounts,{role:'OPTIONAL_ACCOUNT',account_code:'999999',account_class:'ASSET',account_type:'CURRENT',dimension_requirements:[],effective_from:'2026-01-01',effective_to:null,status:'ACTIVE',posting_allowed:true}]}}}
  ]){
    const {kernel:unsafeReader}=kernel(unsafe);await assert.rejects(unsafeReader.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true}),error=>error.code==='WBS_AI_APPROVED_SETTINGS_INVALID');
  }
});

test('keeps human close policy separate from permanently read-only AI authority',async()=>{
  for(const [period_status,policy] of [
    ['SOFT_CLOSED',{allow_post:false,posting_lock:true,hard_lock:false,soft_lock:true}],
    ['CLOSED',{allow_post:false,posting_lock:true,hard_lock:true,soft_lock:false}]
  ]){
    const result={...base,period_status,period_close_policy:{...base.period_close_policy,settings:{...base.period_close_policy.settings,period_status,...policy}}};
    const {kernel:reader}=kernel(result);const dto=await reader.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true});
    assert.equal(dto.period_status,period_status);assert.deepEqual({draft:dto.can_create_draft,review:dto.can_review,approve:dto.can_approve,post:dto.can_post},{draft:false,review:false,approve:false,post:false});
  }
  const invalid={...base,period_close_policy:{...base.period_close_policy,settings:{...base.period_close_policy.settings,posting_lock:true}}};
  const {kernel:reader}=kernel(invalid);await assert.rejects(reader.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true}),error=>error.code==='WBS_AI_APPROVED_SETTINGS_INVALID');
});

test('retains approved close evidence while allowing only monotonic current-period status',async()=>{
  for(const currentStatus of ['SOFT_CLOSED','CLOSED']){
    const historical={...base,period_status:currentStatus};
    const {kernel:reader}=kernel(historical);const dto=await reader.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true});
    assert.equal(dto.period_status,currentStatus);assert.equal(dto.period_close_policy.settings.period_status,'OPEN');assert.equal(dto.period_close_policy.settings.allow_post,true);
  }
  for(const [currentStatus,approvedStatus,policy] of [
    ['OPEN','SOFT_CLOSED',{allow_post:false,posting_lock:true,hard_lock:false,soft_lock:true}],
    ['OPEN','CLOSED',{allow_post:false,posting_lock:true,hard_lock:true,soft_lock:false}],
    ['SOFT_CLOSED','CLOSED',{allow_post:false,posting_lock:true,hard_lock:true,soft_lock:false}]
  ]){
    const backwards={...base,period_status:currentStatus,period_close_policy:{...base.period_close_policy,settings:{...base.period_close_policy.settings,period_status:approvedStatus,...policy}}};
    const {kernel:reader}=kernel(backwards);await assert.rejects(reader.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true}),error=>error.code==='WBS_AI_APPROVED_SETTINGS_INVALID');
  }
});
