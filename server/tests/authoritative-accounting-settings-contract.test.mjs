import assert from'node:assert/strict';import test from'node:test';
import{projectAuthoritativeAccountingSettings}from'../runtime/authoritative-accounting-settings.mjs';
import{approvedSettingsFixture,tenantId,entityId,periodId}from'./wbs-ai-approved-settings-reader.test.mjs';

test('projects approved entity-period settings into a closed read-only summary',()=>{
 const result=projectAuthoritativeAccountingSettings(approvedSettingsFixture(),{tenantId,entityId,periodId});
 assert.equal(result.schema_version,'AUTHORITATIVE_ACCOUNTING_SETTINGS_V1');assert.equal(result.scope.period_id,periodId);assert.equal(result.families.length,10);assert.equal(new Set(result.families.map(row=>row.family)).size,10);assert.equal(result.period_close_policy.allow_post,true);assert.equal(result.period_close_policy.business_calendar,'US');assert.deepEqual(result.period_close_policy.non_business_dates,[]);assert.equal(result.coverage.active_posting_account_count,24);assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.period_close_policy.non_business_dates),true);assert.equal(Object.isFrozen(result.families[0]),true);
});

test('rejects scope, approval and action drift before projection',()=>{
 const base=approvedSettingsFixture();
 for(const value of [{...base,entity_id:'99999999-9999-4999-8999-999999999999'},{...base,approval_status:'DRAFT'},{...base,can_post:true},{...base,approved_by:'Bearer secret-token-value'}])assert.throws(()=>projectAuthoritativeAccountingSettings(value,{tenantId,entityId,periodId}),error=>error.code==='WBS_AI_APPROVED_SETTINGS_INVALID');
});
