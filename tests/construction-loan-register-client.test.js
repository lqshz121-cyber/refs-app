import test from 'node:test';
import assert from 'node:assert/strict';
import {readConstructionLoanRegister} from '../src/construction-loan-register.js';
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const entityId=id('2'),periodId=id('3'),config={baseUrl:'https://fixture.example',tenantId:id('1'),entityId,periodId,getAccessToken:async()=>'fixture-token-'.repeat(4)};
const page={schema_version:'CONSTRUCTION_LOAN_REGISTER_V1',entity_id:entityId,period_id:periodId,period_code:'2026-09',period_start:'2026-09-01',period_end:'2026-09-30',rows:[],blocked_lines:[],exact_ledger_line_count:0,blocked_ledger_line_count:0,action_flags:{can_create_loan:false,can_record_draw:false,can_record_repayment:false,can_post:false}};
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
test('client reads one exact company-period Loan Register using bearer and no-store',async()=>{let call;const result=await readConstructionLoanRegister({config,fetcher:async(url,options)=>(call={url,...options},response({ok:true,data:page}))});assert.equal(result.ok,true);assert.equal(call.method,'GET');assert.equal(call.cache,'no-store');assert.match(call.headers.authorization,/^Bearer /);assert.match(call.url,new RegExp(`/entities/${entityId}/reports/construction-loan-register\\?periodId=${periodId}$`));});
test('client fails closed on scope drift and action claims',async()=>{for(const patch of [{entity_id:id('9')},{period_id:id('9')},{action_flags:{...page.action_flags,can_post:true}}]){const result=await readConstructionLoanRegister({config,fetcher:async()=>response({ok:true,data:{...page,...patch}})});assert.equal(result.ok,false);}});
