import test from 'node:test';import assert from 'node:assert/strict';
import {INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES,reconcileInternalTestWorkflowActorGrants} from '../runtime/internal-test-workflow-grants.mjs';

const scope={tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',actors:Object.fromEntries(['reader','maker','expenseMaker','paymentMaker','receiptMaker','salesReceiptMaker','reversalMaker','adjustmentMaker','refundMaker','allocator','submitter','reviewer','approver','poster','reconciliationStarter','clearer','unmatcher','reopener','periodCloser','periodReopener','cashTransferReconciler','recurringRunner'].map(role=>[role,`internal-${role}`]))};
test('internal full-test grant reconciliation provisions distinct workflow actors',async()=>{
  const calls=[];await reconcileInternalTestWorkflowActorGrants({scope,grantSync:{async currentVersion(){return 2;},async reconcile(command){calls.push(command);}}});
  assert.equal(calls.length,22);
  assert.deepEqual(calls.find(call=>call.actorId===scope.actors.maker).permissions,INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES.maker);
  assert.equal(calls.find(call=>call.actorId===scope.actors.poster).authorityClass,'POST');assert.equal(calls.find(call=>call.actorId===scope.actors.paymentMaker).authorityClass,'PAYMENT');assert.equal(calls.find(call=>call.actorId===scope.actors.periodCloser).authorityClass,'CLOSE');assert.equal(calls.find(call=>call.actorId===scope.actors.receiptMaker).authorityClass,'RECEIPT');assert.equal(calls.find(call=>call.actorId===scope.actors.recurringRunner).authorityClass,'SCHEDULE');
  assert.equal(calls.find(call=>call.actorId===scope.actors.reader).permissions.includes('WBS.AUTOREC.VIEW'),true);
});
test('internal full-test grant reconciliation rejects incomplete actors',async()=>{
  await assert.rejects(reconcileInternalTestWorkflowActorGrants({scope:{...scope,actors:{...scope.actors,poster:scope.actors.approver}},grantSync:{}}),error=>error.code==='INTERNAL_TEST_GRANT_CONFIG_INVALID');
});

test('O06: voidMaker carries AP.BILL.VOID.CREATE under the AP_ADJUSTMENT_MAKER authority class, is skipped when unconfigured, and no other actor mixes that class',async()=>{
  assert.deepEqual([...INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES.voidMaker].filter(p=>!/\.VIEW$/.test(p)),['AP.BILL.VOID.CREATE']);
  for(const [role,bundle] of Object.entries(INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES))if(role!=='voidMaker')assert.equal(bundle.includes('AP.BILL.VOID.CREATE'),false,role);
  const calls=[];const grantSync={currentVersion:async()=>0,reconcile:async args=>{calls.push(args);}};
  await reconcileInternalTestWorkflowActorGrants({grantSync,scope:{...scope,actors:{...scope.actors,voidMaker:null}}});
  assert.equal(calls.some(c=>c.permissions.includes('AP.BILL.VOID.CREATE')),false,'unconfigured optional actor is skipped');
  calls.length=0;
  await reconcileInternalTestWorkflowActorGrants({grantSync,scope:{...scope,actors:{...scope.actors,voidMaker:'void-maker-actor'}}});
  const voidCall=calls.find(c=>c.actorId==='void-maker-actor');assert.ok(voidCall);assert.equal(voidCall.authorityClass,'AP_ADJUSTMENT_MAKER');assert.ok(voidCall.permissions.includes('AP.BILL.VOID.CREATE'));
});
