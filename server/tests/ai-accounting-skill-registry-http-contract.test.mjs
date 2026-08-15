import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',path=`/api/v1/entities/${entityId}/ai/skills`;

test('AI skill registry is an authenticated no-store read with no command or accounting authority',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>{throw new Error('registry must not invoke an accounting kernel');}});
  const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.ok,true);assert.equal(response.body.data.registry_version,'REFS_AI_ACCOUNTING_SKILLS_V1');assert.ok(response.body.data.skills.length>=10);
  for(const skill of response.body.data.skills){assert.deepEqual(skill.prohibited_actions,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});if(skill.status==='PLANNED_SOURCE_CONTRACT')assert.equal(skill.finding_category,null);}
  for(const request of [{headers:{'idempotency-key':'forbidden'},body:null},{headers:{},body:{}},{headers:{},body:null,url:`${path}?x=1`}])assert.equal((await api({method:'GET',url:path,...request})).status,400);
});
