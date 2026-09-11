import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const hash=`sha256:${'a'.repeat(64)}`;
const id=()=>randomUUID();

function kernelWithCalls(){
  const calls=[];
  const kernel=new PostgresAccountingKernel({}, {sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(32)})});
  kernel.inSession=async work=>work({query:async(text,args=[])=>{
    calls.push({text:String(text),args});
    return {rowCount:1,rows:[text.includes('_hash(')?{request_hash:hash}:{result:{ok:true}}]};
  }});
  return {kernel,calls};
}

test('Unit Transfer kernel hashes the exact create payload before issuing the paired Draft command',async()=>{
  const {kernel,calls}=kernelWithCalls();
  const input={tenantId:id(),entityId:id(),targetEntityId:id(),sourcePeriodId:id(),targetPeriodId:id(),transferDate:'2026-09-12',unitRef:'UNIT-301',sourceDocumentId:id(),sourceDocumentLineId:id(),expectedSourceVersion:0,expectedSourceHash:hash,expectedSourceLineHash:hash,expectedSourceAttachmentHash:hash,expectedTransferPrice:'200.0000',sourceMappingSnapshotId:id(),expectedSourceMappingHash:hash,targetMappingSnapshotId:id(),expectedTargetMappingHash:hash,sourceCarryingAccountCodes:['151000'],sourceGainLossAccountCode:'490100',targetInventoryAccountCode:'141000',expectedCarryingAmount:'175.0000',expectedUnitVersion:0,targetAttachmentIds:[id()],expectedTargetAttachmentHash:hash,sourceJournalNumber:'UT-S-001',targetJournalNumber:'UT-T-001',reason:'Approved paired unit transfer evidence.',idempotencyKey:'unit-transfer-create-001'};
  assert.deepEqual(await kernel.createUnitTransfer(input),{ok:true});
  assert.equal(calls.length,2);
  assert.match(calls[0].text,/refs_create_unit_transfer_hash\(\$1,\$2,\$3,\$4,\$5,\$6::date/);
  assert.deepEqual(calls[0].args,[input.tenantId,input.entityId,input.targetEntityId,input.sourcePeriodId,input.targetPeriodId,input.transferDate,input.unitRef,input.sourceDocumentId,input.sourceDocumentLineId,input.expectedSourceVersion,input.expectedSourceHash,input.expectedSourceLineHash,input.expectedSourceAttachmentHash,input.expectedTransferPrice,input.sourceMappingSnapshotId,input.expectedSourceMappingHash,input.targetMappingSnapshotId,input.expectedTargetMappingHash,input.sourceCarryingAccountCodes,input.sourceGainLossAccountCode,input.targetInventoryAccountCode,input.expectedCarryingAmount,input.expectedUnitVersion,input.targetAttachmentIds,input.expectedTargetAttachmentHash,input.sourceJournalNumber,input.targetJournalNumber,input.reason]);
  assert.match(calls[1].text,/refs_create_unit_transfer\(/);
  assert.deepEqual(calls[1].args,[...calls[0].args,input.idempotencyKey,hash]);
});

test('Unit Transfer kernel binds pair and both Journal revisions to transition and Post hashes',async()=>{
  const {kernel,calls}=kernelWithCalls(),scope={tenantId:id(),entityId:id(),pairId:id(),expectedPairRevision:4,expectedSourceRevision:7,expectedTargetRevision:9};
  await kernel.transitionUnitTransfer({...scope,action:'APPROVE',reason:'Both companies approved the same retained evidence.',idempotencyKey:'unit-transfer-approve-001'});
  assert.equal(calls.length,2);
  assert.match(calls[0].text,/refs_unit_transfer_transition_hash/);
  assert.deepEqual(calls[0].args,[scope.tenantId,scope.entityId,scope.pairId,'APPROVE',4,7,9,'Both companies approved the same retained evidence.']);
  assert.deepEqual(calls[1].args,[...calls[0].args,'unit-transfer-approve-001',hash]);
  calls.length=0;
  await kernel.postUnitTransfer({...scope,idempotencyKey:'unit-transfer-post-001'});
  assert.equal(calls.length,2);
  assert.match(calls[0].text,/refs_unit_transfer_post_hash/);
  assert.deepEqual(calls[0].args,[scope.tenantId,scope.entityId,scope.pairId,4,7,9]);
  assert.deepEqual(calls[1].args,[...calls[0].args,'unit-transfer-post-001',hash]);
  calls.length=0;
  const reason='Cancel the stale Draft and retain both Journal records.';
  await kernel.cancelUnitTransfer({...scope,reason,idempotencyKey:'unit-transfer-cancel-001'});
  assert.equal(calls.length,2);
  assert.match(calls[0].text,/refs_unit_transfer_cancel_hash/);
  assert.deepEqual(calls[0].args,[scope.tenantId,scope.entityId,scope.pairId,4,7,9,reason]);
  assert.deepEqual(calls[1].args,[...calls[0].args,'unit-transfer-cancel-001',hash]);
});

test('Unit Transfer kernel reads a pair and entity-period register without command hashes',async()=>{
  const {kernel,calls}=kernelWithCalls(),tenantId=id(),entityId=id(),periodId=id(),pairId=id();
  assert.deepEqual(await kernel.readUnitTransferRegister({tenantId,entityId,periodId}),{ok:true});
  assert.deepEqual(await kernel.readUnitTransferPair({tenantId,entityId,pairId}),{ok:true});
  assert.equal(calls.length,2);
  assert.match(calls[0].text,/refs_read_unit_transfer_register/);
  assert.deepEqual(calls[0].args,[tenantId,entityId,periodId,100,null,null]);
  assert.match(calls[1].text,/refs_read_unit_transfer_pair/);
  assert.deepEqual(calls[1].args,[tenantId,entityId,pairId]);
});

test('Unit Transfer kernel binds create-option scope and selected target attachments',async()=>{
 const {kernel,calls}=kernelWithCalls(),tenantId=id(),entityId=id(),periodId=id(),targetEntityId=id(),targetAttachmentIds=[id()],transferDate='2026-09-12';
 assert.deepEqual(await kernel.readUnitTransferCreateOptions({tenantId,entityId,periodId,targetEntityId,transferDate,targetAttachmentIds}),{ok:true});
 assert.equal(calls.length,1);assert.match(calls[0].text,/refs_read_unit_transfer_create_options/);
 assert.deepEqual(calls[0].args,[tenantId,entityId,periodId,targetEntityId,transferDate,targetAttachmentIds]);
});
