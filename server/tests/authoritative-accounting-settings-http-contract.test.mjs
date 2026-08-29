import assert from'node:assert/strict';import{readFileSync}from'node:fs';import test from'node:test';
import{createAccountingApi}from'../api/accounting-http.mjs';
import{approvedSettingsFixture,tenantId,entityId,periodId}from'./wbs-ai-approved-settings-reader.test.mjs';
const principal={trusted:true,tenantId,actorId:'settings-reader'};

test('Accounting settings GET is exact, no-store and read-only',async()=>{
 let args;const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({readApprovedWbsAiEntityPeriodSettings:async input=>(args=input,approvedSettingsFixture())})});
 const path=`/api/v1/entities/${entityId}/accounting-settings?periodId=${periodId}`,response=await api({method:'GET',url:path,headers:{authorization:'Bearer x'},body:null});
 assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(args,{tenantId,entityId,periodId,readOnly:true});assert.equal(response.body.data.schema_version,'AUTHORITATIVE_ACCOUNTING_SETTINGS_V1');assert.equal(response.body.data.families.length,10);assert.equal(response.body.data.action_flags.can_post,false);
 for(const request of [{method:'GET',url:`${path}&edit=true`,headers:{},body:null},{method:'GET',url:path,headers:{'if-match':'"1"'},body:null},{method:'GET',url:path,headers:{},body:{}}])assert.equal((await api(request)).status,400);
});

test('Accounting settings rejects cross-scope and action-bearing kernel output',async()=>{
 for(const result of [{...approvedSettingsFixture(),entity_id:'99999999-9999-4999-8999-999999999999'},{...approvedSettingsFixture(),can_post:true}]){
  const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({readApprovedWbsAiEntityPeriodSettings:async()=>result})}),response=await api({method:'GET',url:`/api/v1/entities/${entityId}/accounting-settings?periodId=${periodId}`,headers:{},body:null});assert.equal(response.status,503);
 }
});

test('OpenAPI requires the approved business calendar and complete non-business-date population',()=>{
 const api=JSON.parse(readFileSync(new URL('../api/openapi-accounting.json',import.meta.url),'utf8')),policy=api.components.schemas.AuthoritativeAccountingSettings.properties.period_close_policy;
 assert.equal(policy.additionalProperties,false);assert.ok(policy.required.includes('business_calendar'));assert.ok(policy.required.includes('non_business_dates'));assert.equal(policy.properties.non_business_dates.uniqueItems,true);assert.equal(policy.properties.non_business_dates.items.format,'date');
});
