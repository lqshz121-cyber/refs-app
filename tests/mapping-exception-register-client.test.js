import test from 'node:test';
import assert from 'node:assert/strict';
import {readMappingExceptionRegister} from '../src/mapping-exception-register.js';
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const entityId=id('2'),periodId=id('3'),config={baseUrl:'https://fixture.example',tenantId:id('1'),entityId,periodId,getAccessToken:async()=>'fixture-token-'.repeat(4)},flags={can_assign:false,can_review:false,can_resolve:false,can_waive:false,can_create_draft:false,can_post:false};
const page={schema_version:'MAPPING_EXCEPTION_REGISTER_V1',entity_id:entityId,period_id:periodId,period_code:'2026-09',period_start:'2026-09-01',period_end:'2026-09-30',row_count:0,open_count:0,in_review_count:0,resolved_count:0,waived_count:0,rows:[],action_flags:flags};
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
test('client reads one exact no-store company-period Mapping Exception register',async()=>{let call;const result=await readMappingExceptionRegister({config,fetcher:async(url,options)=>(call={url,...options},response({ok:true,data:page}))});assert.equal(result.ok,true);assert.equal(call.method,'GET');assert.equal(call.cache,'no-store');assert.match(call.headers.authorization,/^Bearer /);assert.match(call.url,new RegExp(`/entities/${entityId}/mapping-exceptions\\?periodId=${periodId}$`));});
test('client fails closed on scope or action drift',async()=>{for(const patch of [{entity_id:id('9')},{period_id:id('9')},{action_flags:{...flags,can_post:true}}])assert.equal((await readMappingExceptionRegister({config,fetcher:async()=>response({ok:true,data:{...page,...patch}})})).ok,false);});
