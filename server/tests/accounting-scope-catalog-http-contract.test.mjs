import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId='11111111-1111-4111-8111-111111111111';
const entityId='22222222-2222-4222-8222-222222222222';
const periodId='33333333-3333-4333-8333-333333333333';
const row={entity_id:entityId,entity_name:'WB Pacific LLC',entity_code:'WBPA',base_currency:'USD',source_entity_id:'WBPA',period_id:periodId,period_code:'2026-01',period_start:'2026-01-01',period_end:'2026-01-31',period_status:'OPEN'};

const apiFor=result=>createAccountingApi({
  authenticate:async()=>({trusted:true,tenantId,actorId:'auth0|controller'}),
  kernelFactory:async()=>({listAccountingScopes:async input=>{assert.deepEqual(input,{tenantId});return result;}}),
});

test('GET accounting scopes returns only the authenticated database catalog and no-store',async()=>{
  const response=await apiFor([row])({method:'GET',url:'/api/v1/accounting-scopes'});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,[row]);
});

test('accounting scope catalog rejects command inputs and unsafe repository shapes',async()=>{
  assert.equal((await apiFor([row])({method:'GET',url:'/api/v1/accounting-scopes?entityId=x'})).status,400);
  assert.equal((await apiFor([row])({method:'GET',url:'/api/v1/accounting-scopes',headers:{'idempotency-key':'not-allowed'}})).status,400);
  assert.equal((await apiFor([row])({method:'GET',url:'/api/v1/accounting-scopes',body:{}})).status,400);
  for(const invalid of [[{...row,raw_credentials:'secret'}],[row,row],[{...row,period_end:'2026-02-01'}]]){
    const response=await apiFor(invalid)({method:'GET',url:'/api/v1/accounting-scopes'});
    assert.equal(response.status,500);assert.equal(response.body.code,'ACCOUNTING_SCOPE_CATALOG_INVALID');
  }
});
