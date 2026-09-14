import test from 'node:test';import assert from 'node:assert/strict';
import {INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES,reconcileInternalTestWorkflowActorGrants} from '../runtime/internal-test-workflow-grants.mjs';

const scope={tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',actors:Object.fromEntries(['reader','maker','paymentMaker','reversalMaker','allocator','submitter','reviewer','approver','poster','reconciliationStarter','clearer','reopener','periodCloser','periodReopener','cashTransferReconciler'].map(role=>[role,`internal-${role}`]))};
test('internal full-test grant reconciliation provisions distinct workflow actors',async()=>{
  const calls=[];await reconcileInternalTestWorkflowActorGrants({scope,grantSync:{async currentVersion(){return 2;},async reconcile(command){calls.push(command);}}});
  assert.equal(calls.length,15);
  assert.deepEqual(calls.find(call=>call.actorId===scope.actors.maker).permissions,INTERNAL_TEST_WORKFLOW_GRANT_BUNDLES.maker);
  assert.equal(calls.find(call=>call.actorId===scope.actors.poster).authorityClass,'POST');assert.equal(calls.find(call=>call.actorId===scope.actors.paymentMaker).authorityClass,'PAYMENT');assert.equal(calls.find(call=>call.actorId===scope.actors.periodCloser).authorityClass,'CLOSE');
  assert.equal(calls.find(call=>call.actorId===scope.actors.reader).permissions.includes('WBS.AUTOREC.VIEW'),true);
});
test('internal full-test grant reconciliation rejects incomplete actors',async()=>{
  await assert.rejects(reconcileInternalTestWorkflowActorGrants({scope:{...scope,actors:{...scope.actors,poster:scope.actors.approver}},grantSync:{}}),error=>error.code==='INTERNAL_TEST_GRANT_CONFIG_INVALID');
});
