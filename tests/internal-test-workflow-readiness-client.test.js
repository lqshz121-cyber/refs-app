// O05 browser contract: on the internal-test site the Journal capability read overlays the routed actors' readiness;
// anywhere else it never calls the readiness route and keeps the reader's own flags.
import assert from 'node:assert/strict';
import {accountingApiConfig,readAuthoritativeJournalWorkflowCapabilities,readInternalTestWorkflowReadiness} from '../src/accounting-api.js';
(async()=>{
const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222';
const base={baseUrl:'https://api.test',entityId,periodId,cashAccountCode:'111000',deploymentEnvironment:'internal-test',internalTestNoLogin:true,getAccessToken:async()=>'token-token-token-1234'};
const cfgInternal=accountingApiConfig({__REFS_ACCOUNTING_API__:base});
const cfgStaging=accountingApiConfig({__REFS_ACCOUNTING_API__:{...base,deploymentEnvironment:'staging',internalTestNoLogin:false}});
assert.equal(cfgInternal.internalTestNoLogin,true);assert.equal(cfgStaging.internalTestNoLogin,false);
const readiness={schema_version:'INTERNAL_TEST_WORKFLOW_READINESS_V1',entity_id:entityId,profile:'FULL_WORKFLOW',test_only:true,grants_widened:false,can_grant:false,master_data:{OPEN_PERIOD:true,BANK:true,VENDOR:true,CUSTOMER:false},
  roles:{submitter:{permissions:{'GL.JE.SUBMIT':true},ready:true,missing:[]},reviewer:{permissions:{'GL.JE.REVIEW':true},ready:true,missing:[]},approver:{permissions:{'GL.JE.APPROVE':true},ready:true,missing:[]},poster:{permissions:{'GL.JE.POST':false},ready:false,missing:['GL.JE.POST']}},
  workflows:Object.fromEntries(['JOURNAL_ENTRY','AP_BILL','AP_PAYMENT','AP_PAYMENT_REVERSAL','AP_BILL_VOID','AR_INVOICE','AR_RECEIPT','AR_RECEIPT_REVERSAL','BANK_RECONCILE'].map(k=>[k,{ready:k!=='AP_BILL_VOID',blocking:k==='AP_BILL_VOID'?[{kind:'GRANT',role:'reversalMaker',permission:'AP.BILL.VOID.CREATE'}]:[]}]))};
const calls=[];
const fetcher=async(url,init)=>{calls.push(url);const ok=body=>({ok:true,status:200,headers:{get:()=>'application/json'},json:async()=>({ok:true,data:body})});
  if(/journal-workflow\/capabilities$/.test(url))return ok({entity_id:entityId,can_submit:false,can_review:false,can_approve:false,can_post:false});
  if(/internal-test\/workflow-readiness$/.test(url)){assert.equal(init.headers.authorization,undefined,'anonymous internal-test read carries no bearer');return ok(readiness);}
  return {ok:false,status:404,headers:{get:()=>'application/json'},json:async()=>({ok:false,code:'ROUTE_NOT_FOUND'})};};
// internal-test: overlay applied, poster stays false because the routed poster lacks GL.JE.POST in this fixture
const internal=await readAuthoritativeJournalWorkflowCapabilities({config:cfgInternal,fetcher});
assert.equal(internal.ok,true);assert.deepEqual({s:internal.capabilities.can_submit,r:internal.capabilities.can_review,a:internal.capabilities.can_approve,p:internal.capabilities.can_post},{s:true,r:true,a:true,p:false});
assert.equal(internal.internal_test_readiness.workflows.AP_BILL_VOID.ready,false);
assert.ok(calls.some(u=>/internal-test\/workflow-readiness$/.test(u)));
// staging: readiness route is never called; reader flags stand
calls.length=0;
const staging=await readAuthoritativeJournalWorkflowCapabilities({config:cfgStaging,fetcher});
assert.equal(staging.ok,true);assert.equal(staging.capabilities.can_submit,false);assert.equal(staging.internal_test_readiness,undefined);
assert.equal(calls.some(u=>/internal-test\/workflow-readiness$/.test(u)),false);
const direct=await readInternalTestWorkflowReadiness({config:cfgStaging,fetcher});assert.equal(direct.ok,false);assert.equal(direct.code,'INTERNAL_TEST_ONLY');
// overlay failure degrades to the reader's honest flags
const failing=async(url,init)=>/workflow-readiness$/.test(url)?{ok:false,status:404,headers:{get:()=>'application/json'},json:async()=>({ok:false,code:'ROUTE_NOT_FOUND',message:'Route not found'})}:fetcher(url,init);
const degraded=await readAuthoritativeJournalWorkflowCapabilities({config:cfgInternal,fetcher:failing});
assert.equal(degraded.ok,true);assert.equal(degraded.capabilities.can_submit,false);assert.equal(degraded.internal_test_readiness,undefined);
// a protocol-invalid readiness (grants_widened true) is rejected
const widened=async(url,init)=>/workflow-readiness$/.test(url)?{ok:true,status:200,headers:{get:()=>'application/json'},json:async()=>({ok:true,data:{...readiness,grants_widened:true}})}:fetcher(url,init);
const rejected=await readInternalTestWorkflowReadiness({config:cfgInternal,fetcher:widened});assert.equal(rejected.ok,false);assert.equal(rejected.code,'ACCOUNTING_API_PROTOCOL');
console.log('PASS internal-test workflow readiness client overlay');
})().catch(error=>{console.error(error);process.exitCode=1;});
