import assert from 'node:assert/strict';
import test from 'node:test';
import {bootstrapInternalTestCashControls,INTERNAL_TEST_CASH_CONTROLS} from '../runtime/internal-test-cash-control-bootstrap.mjs';

test('internal-test cash controls use maker creation and separate approver lifecycle',async()=>{
  const calls=[];
  const makerKernel={readCashTransferBankAccountControls:async()=>({rows:[]}),createCashTransferBankAccountControl:async input=>{calls.push(['create',input]);return {cash_transfer_bank_account_control_id:`control-${calls.length}`,revision:0};}};
  const approverKernel={approveCashTransferBankAccountControl:async input=>calls.push(['approve',input])};
  await bootstrapInternalTestCashControls({makerKernel,approverKernel,tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222'});
  assert.equal(INTERNAL_TEST_CASH_CONTROLS.length,2);assert.deepEqual(INTERNAL_TEST_CASH_CONTROLS.map(row=>row.bankMemberRef),['INTERNAL_TEST_BANK','INTERNAL_TEST_BANK_DESTINATION']);
  assert.equal(calls.filter(([kind])=>kind==='create').length,2);assert.equal(calls.filter(([kind])=>kind==='approve').length,2);
  assert.deepEqual(calls[0][1].effectiveTo,'2026-09-14');assert.equal(calls[2][1].cashAccountCode,'111991');
  assert.match(calls[1][1].idempotencyKey,/approve$/);
});
test('internal-test cash controls do not recreate already approved mappings',async()=>{
  const calls=[];const rows=INTERNAL_TEST_CASH_CONTROLS.map((row,index)=>({bank_member_ref:row.bankMemberRef,cash_account_code:row.cashAccountCode,currency:row.currency,effective_from:row.effectiveFrom,effective_to:row.effectiveTo,status:'APPROVED',control_id:`existing-${index}`,revision:1}));
  await bootstrapInternalTestCashControls({makerKernel:{readCashTransferBankAccountControls:async()=>({rows}),createCashTransferBankAccountControl:async()=>{calls.push('create');}},approverKernel:{approveCashTransferBankAccountControl:async()=>{calls.push('approve');}},tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222'});
  assert.deepEqual(calls,[]);
});
