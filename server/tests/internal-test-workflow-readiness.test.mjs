import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {INTERNAL_TEST_WORKFLOWS,assertInternalTestWorkflowReadiness,createInternalTestWorkflowReadinessService} from '../runtime/internal-test-workflow-readiness.mjs';
import {INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES} from '../runtime/internal-test-workflow-grants.mjs';
import {createAccountingApi} from '../api/accounting-http.mjs';

const ROLES=Object.keys(INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES);
const actors=Object.fromEntries(ROLES.map(r=>[r,r==='voidMaker'?null:`refs-internal-${r.toLowerCase()}`]));
const tenantId=randomUUID(),entityId=randomUUID();
// A fake kernel per actor that answers permission flags from the configured grant bundle — i.e. the world the
// startup reconciliation produces — with an optional override for master data and per-role withheld permissions.
function fakeKernelFactory({withhold={},master={OPEN_PERIOD:true,BANK:true,VENDOR:true,CUSTOMER:false},calls=[]}={}){
  const roleOf=actorId=>ROLES.find(r=>actors[r]===actorId);
  return actorId=>({
    readEntityPermissionFlags:async({permissions})=>{const role=roleOf(actorId);calls.push({role,permissions});const bundle=new Set(INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES[role]||[]);const held=new Set(withhold[role]||[]);return Object.fromEntries(permissions.map(p=>[p,bundle.has(p)&&!held.has(p)]));},
    readInternalTestMasterDataReadiness:async()=>master
  });
}

test('readiness reflects the configured bundles: AP bill void is blocked by a missing grant and AR flows by missing CUSTOMER master data',async()=>{
  const calls=[];const service=createInternalTestWorkflowReadinessService({tenantId,actors,kernelForActor:fakeKernelFactory({calls})});
  const r=assertInternalTestWorkflowReadiness(await service.read({entityId}),{entityId});
  assert.equal(r.workflows.JOURNAL_ENTRY.ready,true);assert.equal(r.workflows.AP_BILL.ready,true);assert.equal(r.workflows.AP_PAYMENT.ready,true);assert.equal(r.workflows.AP_PAYMENT_REVERSAL.ready,true);assert.equal(r.workflows.BANK_RECONCILE.ready,true);
  assert.equal(r.workflows.AP_BILL_VOID.ready,false);assert.deepEqual(r.workflows.AP_BILL_VOID.blocking,[{kind:'GRANT',role:'voidMaker',permission:'AP.BILL.VOID.CREATE'}]);assert.equal(r.roles.voidMaker.actor_configured,false);
  assert.equal(r.workflows.AR_INVOICE.ready,false);assert.deepEqual(r.workflows.AR_INVOICE.blocking,[{kind:'MASTER_DATA',key:'CUSTOMER'}]);
  assert.deepEqual(r.workflows.AR_RECEIPT.blocking,[{kind:'MASTER_DATA',key:'CUSTOMER'}]);
  assert.equal(r.grants_widened,false);assert.equal(r.can_grant,false);
  assert.equal(JSON.stringify(r).includes('refs-internal-'),false,'actor identifiers are not echoed');
  // every role is asked only about the permissions its workflows need, under its own session
  assert.ok(calls.every(c=>c.role&&c.permissions.length>0));assert.ok(calls.some(c=>c.role==='poster'&&c.permissions.includes('GL.JE.POST')));
});

test('a withheld grant surfaces on every workflow that needs it, and a 42501 actor reads as not ready instead of failing the whole answer',async()=>{
  const service=createInternalTestWorkflowReadinessService({tenantId,actors,kernelForActor:fakeKernelFactory({withhold:{approver:['GL.JE.APPROVE']},master:{OPEN_PERIOD:false,BANK:true,VENDOR:true,CUSTOMER:true}})});
  const r=await service.read({entityId});
  for(const wf of ['JOURNAL_ENTRY','AP_BILL','AR_INVOICE'])assert.ok(r.workflows[wf].blocking.some(b=>b.kind==='GRANT'&&b.role==='approver'&&b.permission==='GL.JE.APPROVE'),wf);
  assert.ok(Object.values(r.workflows).every(w=>w.blocking.some(b=>b.kind==='MASTER_DATA'&&b.key==='OPEN_PERIOD')),'no OPEN period blocks every workflow');
  const denied=createInternalTestWorkflowReadinessService({tenantId,actors,kernelForActor:actorId=>({readEntityPermissionFlags:async()=>{const e=new Error('denied');e.code='42501';throw e;},readInternalTestMasterDataReadiness:async()=>({OPEN_PERIOD:true,BANK:true,VENDOR:true,CUSTOMER:true})})});
  const d=await denied.read({entityId});assert.ok(Object.values(d.workflows).every(w=>!w.ready));assert.equal(d.roles.poster.ready,false);
  await assert.rejects(service.read({entityId:'nope'}),e=>e.code==='INTERNAL_TEST_READINESS_SCOPE_INVALID');
  assert.throws(()=>createInternalTestWorkflowReadinessService({tenantId,actors:{reader:'x'},kernelForActor:()=>({})}),e=>e.code==='INTERNAL_TEST_READINESS_CONFIG_INVALID');
});

test('HTTP: the route exists only when the internal-test readiness factory is mounted, is a bodyless no-store GET, and refuses command headers',async()=>{
  const principal={trusted:true,tenantId,actorId:'reader',internalTest:true};
  const absent=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({})});
  const path=`/api/v1/entities/${entityId}/internal-test/workflow-readiness`;
  assert.equal((await absent({method:'GET',url:path,body:null,headers:{}})).status,404);
  const service=createInternalTestWorkflowReadinessService({tenantId,actors,kernelForActor:fakeKernelFactory()});
  const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({}),internalTestWorkflowReadinessServiceFactory:async()=>({readiness:({entityId})=>service.read({entityId})})});
  const ok=await api({method:'GET',url:path,body:null,headers:{}});
  assert.equal(ok.status,200);assert.equal(ok.headers['cache-control'],'no-store');assert.equal(ok.body.data.schema_version,'INTERNAL_TEST_WORKFLOW_READINESS_V1');assert.equal(ok.body.data.workflows.AP_BILL_VOID.ready,false);
  assert.ok([400,404,405].includes((await api({method:'POST',url:path,body:{},headers:{}})).status),'POST is not a readiness command');
  assert.equal((await api({method:'GET',url:path,body:{},headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`${path}?x=1`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:path,body:null,headers:{'if-match':'"1"'}})).status,400);
  const broken=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({}),internalTestWorkflowReadinessServiceFactory:async()=>({readiness:async()=>({schema_version:'X'})})});
  const protocol=await broken({method:'GET',url:path,body:null,headers:{}});assert.equal(protocol.status,502);assert.equal(protocol.body.code,'INTERNAL_TEST_READINESS_PROTOCOL');
});

test('every workflow role named in the readiness spec exists in the grant bundles, so the spec cannot drift from the router actors',()=>{
  for(const [wf,spec] of Object.entries(INTERNAL_TEST_WORKFLOWS))for(const role of Object.keys(spec.roles))assert.ok(ROLES.includes(role),`${wf}: ${role}`);
});
