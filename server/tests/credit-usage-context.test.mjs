import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {validCreditUsageContext} from '../runtime/credit-usage-context.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',businessAdjustmentId='33333333-3333-4333-8333-333333333333',periodId='44444444-4444-4444-8444-444444444444';
const selection={entityId,action:'AR_REFUND',businessAdjustmentId,periodId};
const data={schema_version:'CREDIT_USAGE_CONTEXT_V1',entity_id:entityId,action:'AR_REFUND',period:{period_id:periodId,starts_on:'2026-08-01',ends_on:'2026-08-31',status:'OPEN',revision:'0'},credit:{business_adjustment_id:businessAdjustmentId,adjustment_kind:'AR_CREDIT_MEMO',journal_entry_id:periodId,number:'CM-1',counterparty_ref:'C-1',currency:'USD',amount:'100.0000',revision:'1'},allocated_amount:'30.0000',refund_amount:'10.0000',available_amount:'60.0000'};
const path=`/api/v1/entities/${entityId}/business-adjustments/${businessAdjustmentId}/usage-context`;
test('credit availability checks exact scope, decimal arithmetic and closed periods without authorizing commands',()=>{
  assert.equal(validCreditUsageContext(data,selection),true);
  for(const patch of [{entity_id:tenantId},{action:'AP_CREDIT_APPLY'},{allocated_amount:'30'},{refund_amount:'-1.0000'},{available_amount:'70.0000'},{can_post:true}])assert.equal(validCreditUsageContext({...data,...patch},selection),false);
  assert.equal(validCreditUsageContext({...data,period:{...data.period,status:'CLOSED'}},selection),true);
  assert.equal(validCreditUsageContext({...data,allocated_amount:'110.0000',available_amount:'-20.0000'},selection),true,'preserve negative capacity instead of hiding overcommitment');
  const large={...data,credit:{...data.credit,amount:'9999999999999999.9999'},allocated_amount:'9999999999999999.0000',refund_amount:'0.0001',available_amount:'0.9998'};
  assert.equal(validCreditUsageContext(large,selection),true);
});
test('credit apply contexts preserve kind-specific balances and the published read contract',()=>{
  for(const action of ['AP_CREDIT_APPLY','AR_CREDIT_APPLY']){
    const reply={...data,action,credit:{...data.credit,adjustment_kind:action==='AP_CREDIT_APPLY'?'AP_VENDOR_CREDIT':'AR_CREDIT_MEMO'},refund_amount:'0.0000',available_amount:'70.0000'};
    assert.equal(validCreditUsageContext(reply,{...selection,action}),true);
    assert.equal(validCreditUsageContext({...reply,credit:{...reply.credit,revision:'9223372036854775808'}},{...selection,action}),false);
    if(action==='AP_CREDIT_APPLY')assert.equal(validCreditUsageContext({...reply,refund_amount:'1.0000',available_amount:'69.0000'},{...selection,action}),false);
  }
  const contract=JSON.parse(fs.readFileSync(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  const operation=contract.paths['/entities/{entityId}/business-adjustments/{businessAdjustmentId}/usage-context'].get;
  assert.equal(operation.operationId,'readCreditUsageContext');
  assert.deepEqual(operation.parameters.find(p=>p.name==='action').schema.enum,['AP_CREDIT_APPLY','AR_CREDIT_APPLY','AR_REFUND']);
});
test('credit context GET derives identity, rejects command inputs and rejects contradictory replies',async()=>{
  const calls=[];let returned=data;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({readCreditUsageContext:async args=>{calls.push(args);return returned;}})});
  const get=(suffix,patch={})=>api({method:'GET',url:path+suffix,headers:{},body:null,...patch});
  const query=`?action=AR_REFUND&periodId=${periodId}`;
  const response=await get(query);assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls,[{tenantId,...selection}]);
  for(const suffix of ['',`?action=BAD&periodId=${periodId}`,query+'&action=AR_REFUND',query+'&tenantId=spoof','?action=AR_REFUND&periodId=bad'])assert.equal((await get(suffix)).status,400);
  for(const patch of [{body:{}},{headers:{'idempotency-key':'not-a-command'}},{headers:{'if-match':'"1"'}}])assert.equal((await get(query,patch)).status,400);
  assert.equal(calls.length,1);
  returned={...data,available_amount:'99.0000'};assert.equal((await get(query)).status,500);
});
