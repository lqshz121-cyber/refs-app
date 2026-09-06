import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {validCreditTargetSelection,validCreditTargets} from '../runtime/credit-allocation-targets.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',businessAdjustmentId='33333333-3333-4333-8333-333333333333',periodId='44444444-4444-4444-8444-444444444444',targetId='55555555-5555-4555-8555-555555555555';
const selection={entityId,action:'AR_CREDIT_APPLY',businessAdjustmentId,periodId,query:'INV_%',afterId:null,limit:1};
const context={schema_version:'CREDIT_USAGE_CONTEXT_V1',entity_id:entityId,action:selection.action,period:{period_id:periodId,starts_on:'2026-08-01',ends_on:'2026-08-31',status:'OPEN',revision:'0'},credit:{business_adjustment_id:businessAdjustmentId,adjustment_kind:'AR_CREDIT_MEMO',journal_entry_id:periodId,number:'CM-1',counterparty_ref:'C-1',currency:'USD',amount:'100.0000',revision:'1'},allocated_amount:'30.0000',refund_amount:'10.0000',available_amount:'60.0000'};
const row={business_document_id:targetId,document_number:'INV_%',counterparty_ref:'C-1',currency:'USD',accounting_date:'2026-07-01',due_date:null,gross_amount:'100.0000',open_balance:'90.0000',pending_amount:'20.0000',available_amount:'70.0000',revision:'2',status:'PARTIALLY_PAID',period_id:entityId,journal_entry_id:targetId};
const data={schema_version:'CREDIT_ALLOCATION_TARGETS_V1',context,query:selection.query,after_id:null,limit:1,rows:[row],next_id:targetId};
test('credit target pages bind scope and exact balances while allowing other source periods',()=>{
  assert.equal(validCreditTargets(data,selection),true);
  for(const patch of [{counterparty_ref:'OTHER'},{currency:'EUR'},{pending_amount:'21.0000'},{available_amount:'0.0000'},{gross_amount:'89.0000'},{revision:'9223372036854775808'},{status:'PAID'},{journal_entry_id:null}])assert.equal(validCreditTargets({...data,rows:[{...row,...patch}]},selection),false);
  for(const patch of [{next_id:entityId},{after_id:targetId},{rows:[row,row]},{can_apply:true}])assert.equal(validCreditTargets({...data,...patch},selection),false);
  assert.equal(validCreditTargets({...data,context:{...context,entity_id:tenantId}},selection),false);
  assert.equal(validCreditTargets({...data,rows:[],next_id:null},selection),true);
  for(const patch of [{action:'AR_REFUND'},{query:' bad'},{query:'\n'},{afterId:'bad'},{limit:101},{limit:0}])assert.equal(validCreditTargetSelection({...selection,...patch}),false);
});
test('credit target GET derives identity and rejects spoofed filters and malformed replies',async()=>{
  const calls=[];let returned=data;
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({readCreditAllocationTargets:async args=>{calls.push(args);return returned;}})});
  const path=`/api/v1/entities/${entityId}/business-adjustments/${businessAdjustmentId}/allocation-targets`;
  const query=`?action=AR_CREDIT_APPLY&periodId=${periodId}&query=INV_%25&limit=1`;
  const get=(suffix=query,patch={})=>api({method:'GET',url:path+suffix,headers:{},body:null,...patch});
  const response=await get();assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls,[{tenantId,...selection}]);
  for(const suffix of ['',query+'&counterpartyRef=OTHER',query+'&currency=EUR',query+'&tenantId=spoof',query+'&limit=2',query.replace('limit=1','limit=1e1'),query+'&afterId=bad'])assert.equal((await get(suffix)).status,400);
  for(const patch of [{body:{}},{headers:{'idempotency-key':'not-a-command'}},{headers:{'if-match':'"1"'}}])assert.equal((await get(query,patch)).status,400);
  assert.equal(calls.length,1);
  returned={...data,rows:[{...row,counterparty_ref:'OTHER'}]};assert.equal((await get()).status,500);
});
