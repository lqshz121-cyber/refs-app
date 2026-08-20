import assert from 'node:assert/strict';
import test from 'node:test';
import {createProductionAiAccountingDecisionPacketServiceFactory,createProductionAiAccountingSettingsAdapterFactory} from '../runtime/accounting-server.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=id(1),entityId=id(2),periodId=id(3);

test('production AI settings factory binds the adapter to the authenticated kernel reader only',async()=>{
  const calls=[];
  const factory=createProductionAiAccountingSettingsAdapterFactory({kernelFor:principal=>({
    readApprovedWbsAiEntityPeriodSettings:async input=>{calls.push({principal,input});throw Object.assign(new Error('approved settings unavailable'),{code:'WBS_AI_APPROVED_SETTINGS_INVALID'});}
  })});
  const principal=Object.freeze({trusted:true,tenantId,actorId:'human-controller'}),adapter=factory(principal);
  await assert.rejects(adapter.build({tenantId,entityId,accountingPeriodId:periodId,source:{company_code:'WBPA',currency:'USD'}}),error=>error.code==='WBS_AI_APPROVED_SETTINGS_INVALID');
  assert.deepEqual(calls,[{principal,input:{tenantId,entityId,periodId,readOnly:true}}]);
});

test('production AI settings factory rejects untrusted, cross-tenant, mutable, or non-kernel access',async()=>{
  assert.throws(()=>createProductionAiAccountingSettingsAdapterFactory(),TypeError);
  const missing=createProductionAiAccountingSettingsAdapterFactory({kernelFor:()=>({})});
  assert.throws(()=>missing({trusted:true,tenantId,actorId:'human-controller'}),TypeError);
  const calls=[],factory=createProductionAiAccountingSettingsAdapterFactory({kernelFor:()=>({readApprovedWbsAiEntityPeriodSettings:async input=>(calls.push(input),{})})}),adapter=factory({trusted:true,tenantId,actorId:'human-controller'});
  await assert.rejects(adapter.build({tenantId:id(9),entityId,accountingPeriodId:periodId,source:{company_code:'WBPA',currency:'USD'}}),error=>error.code==='AI_ACCOUNTING_SETTINGS_SCOPE_INVALID');
  assert.equal(calls.length,0);
  assert.throws(()=>factory({trusted:false,tenantId,actorId:'human-controller'}),TypeError);
});

test('production decision service builder receives only a principal-scoped kernel and approved-settings adapter',async()=>{
  const kernel={readApprovedWbsAiEntityPeriodSettings:async()=>{throw new Error('not called by this proof');}},principal=Object.freeze({trusted:true,tenantId,actorId:'human-controller'}),seen=[];
  const factory=createProductionAiAccountingDecisionPacketServiceFactory({kernelFor:received=>(assert.equal(received,principal),kernel),serviceBuilder:dependencies=>(seen.push(dependencies),{analyze:async scope=>scope})});
  const service=factory(principal),scope={tenantId,entityId,accountingPeriodId:periodId,limit:10};
  assert.deepEqual(await service.analyze(scope),scope);assert.equal(seen.length,1);assert.equal(seen[0].principal,principal);assert.equal(seen[0].kernel,kernel);assert.equal(typeof seen[0].settingsAdapter.build,'function');
  assert.deepEqual(Object.keys(seen[0]).sort(),['kernel','principal','settingsAdapter']);
  assert.throws(()=>createProductionAiAccountingDecisionPacketServiceFactory({kernelFor:()=>kernel}),TypeError);
  assert.throws(()=>createProductionAiAccountingDecisionPacketServiceFactory({kernelFor:()=>kernel,serviceBuilder:()=>({})})(principal),TypeError);
});
