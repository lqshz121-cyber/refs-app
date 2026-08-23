import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),hash=`sha256:${'b'.repeat(64)}`;
const data={schema_version:'WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_V1',status:'READY_FOR_HUMAN_REVIEW',company_code:'WBFL',currency:'USD',period_id:periodId,period_code:'2026-01',period_start:'2026-01-01',period_end:'2026-01-31',source_setting_count:0,ready_rule_count:0,blocked_rule_count:0,exception_count:0,rules:[],source_mode:'REAL_WBS_STAGED',accounting_authority:'NONE',can_create_draft:false,can_review:false,can_approve:false,can_post:false,proposal_hash:hash};

test('WBS H1 Settings proposal is exact no-store GET and rejects action drift',async()=>{const calls=[];let returned=data;const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readWbsH1AccountingSettingsProposal:async args=>(calls.push(args),returned)})}),path=`/api/v1/entities/${entityId}/wbs/h1-accounting-settings-proposal?periodId=${periodId}`;let response=await api({method:'GET',url:path,body:null,headers:{}});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls,[{tenantId,entityId,periodId}]);for(const request of [{method:'GET',url:path,body:{},headers:{}},{method:'GET',url:`${path}&extra=1`,body:null,headers:{}},{method:'GET',url:path,body:null,headers:{'if-match':'"0"'}}])assert.equal((await api(request)).status,400);returned={...data,can_approve:true};response=await api({method:'GET',url:path,body:null,headers:{}});assert.equal(response.status,502);});
