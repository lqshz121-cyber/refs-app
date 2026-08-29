import assert from'node:assert/strict';
import test from'node:test';
import{randomUUID}from'node:crypto';
import{createAccountingApi}from'../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),snapshotId=randomUUID(),hash=`sha256:${'a'.repeat(64)}`,family='AI_ACCOUNTING_PERIOD_CLOSE_POLICY_V1';
const item={schema_version:'AUTHORITATIVE_SETTING_HISTORY_ITEM_V1',setting_snapshot_id:snapshotId,family,version:3,status:'APPROVED',effective_from:'2026-08-01T00:00:00.000Z',effective_to:null,snapshot_hash:hash,lifecycle_revision:1,created_by:'settings-maker',approved_by:'settings-approver',approved_at:'2026-08-02T00:00:00.000Z',retirement:null,reference_counts:{entity_period_bindings:1,rule_evaluations:2,staging_items:3,wbs_reviews:4,ai_evidence:5,total:15},integrity_verified:true};
const page={schema_version:'AUTHORITATIVE_SETTING_HISTORY_PAGE_V1',scope:{tenant_id:tenantId,entity_id:entityId,family},total_count:1,read_count:1,items:[item],has_more:false,next_cursor:null,reference_classes:['ENTITY_PERIOD_BINDING','RULE_EVALUATION','STAGING_ITEM','WBS_REVIEW','AI_EVIDENCE'],redaction:{snapshot_body_excluded:true,retirement_reason_hashed:true,credential_shaped_actor_redacted:true},action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}};
const principal={trusted:true,tenantId,actorId:'settings-reader'};

test('Settings history GET is exact, no-store, scoped and read only',async()=>{
  let args;const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({readAuthoritativeSettingHistory:async input=>(args=input,page)})});
  const path=`/api/v1/entities/${entityId}/accounting-settings/history?family=${family}&limit=25`,response=await api({method:'GET',url:path,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(args,{tenantId,entityId,family,limit:25,cursorVersion:null,cursorId:null});assert.equal(response.body.data.items[0].reference_counts.total,15);assert.equal(response.body.data.action_flags.can_post,false);
  for(const request of [{method:'GET',url:`${path}&edit=true`,headers:{},body:null},{method:'GET',url:path,headers:{'if-match':'"3"'},body:null},{method:'GET',url:path,headers:{},body:{}},{method:'GET',url:`/api/v1/entities/${entityId}/accounting-settings/history?family=UNKNOWN`,headers:{},body:null}])assert.equal((await api(request)).status,400);
});

test('Settings history rejects action, secret, count, order and cursor drift',async()=>{
  const second={...item,setting_snapshot_id:randomUUID(),version:2};
  for(const unsafe of [
    {...page,action_flags:{...page.action_flags,can_post:true}},
    {...page,items:[{...item,approved_by:'Bearer unsafe-token'}]},
    {...page,items:[{...item,created_by:'sk-abcdefgh12345678'}]},
    {...page,items:[{...item,reference_counts:{...item.reference_counts,total:14}}]},
    {...page,total_count:2,read_count:2,items:[second,item]},
    {...page,has_more:true,next_cursor:{version:2,setting_snapshot_id:randomUUID()}}
  ]){const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({readAuthoritativeSettingHistory:async()=>unsafe})}),response=await api({method:'GET',url:`/api/v1/entities/${entityId}/accounting-settings/history?family=${family}&limit=25`,headers:{},body:null});assert.equal(response.status,502);}
});
