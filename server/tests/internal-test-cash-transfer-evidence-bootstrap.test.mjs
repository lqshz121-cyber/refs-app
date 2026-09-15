import assert from 'node:assert/strict';
import test from 'node:test';
import {bootstrapInternalTestCashTransferEvidence} from '../runtime/internal-test-cash-transfer-evidence-bootstrap.mjs';

test('internal-test cash-transfer evidence bootstrap is a bounded maker-only idempotent call',async()=>{
  const calls=[];
  const result=await bootstrapInternalTestCashTransferEvidence({makerKernel:{ensureInternalTestCashTransferEvidence:async input=>(calls.push(input),{attachment_id:'42100000-0000-4000-8000-000000000001',status:'VERIFIED_CLEAN'})},tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222'});
  assert.equal(result.status,'VERIFIED_CLEAN');
  assert.deepEqual(calls,[{tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',idempotencyKey:'internal-test-cash-transfer-evidence-v1-22222222-2222-4222-8222-222222222222'}]);
});

test('internal-test cash-transfer evidence bootstrap rejects an unavailable kernel',async()=>{
  await assert.rejects(()=>bootstrapInternalTestCashTransferEvidence({makerKernel:{},tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222'}),/bootstrap kernel/);
});
