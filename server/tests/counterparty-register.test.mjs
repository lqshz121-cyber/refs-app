import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {validCounterpartyRegisterPage} from '../runtime/counterparty-register.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222';
const path=`/api/v1/entities/${entityId}/counterparties`;
const page=s=>({schema_version:'COUNTERPARTY_REGISTER_V1',entity_id:entityId,kind:s.kind,status:s.status,query:s.query,after_ref:s.afterRef,limit:s.limit,rows:[],next_ref:null});
test('register API derives tenant and validates filters before reading',async()=>{
  const calls=[],api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readCounterpartyRegister:async s=>(calls.push(s),page(s))})});
  const request=url=>api({method:'GET',url,headers:{},body:null});
  const r=await request(path+'?kind=VENDOR&status=INACTIVE&query=50%25_&afterRef=V-01&limit=25');
  assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(calls,[{tenantId,entityId,kind:'VENDOR',status:'INACTIVE',query:'50%_',afterRef:'V-01',limit:25}]);
  for(const suffix of ['', '?kind=VENDOR&kind=CUSTOMER','?kind=AFFILIATE','?kind=VENDOR&status=UNKNOWN','?kind=VENDOR&limit=101','?kind=VENDOR&limit=01','?kind=VENDOR&query=%20x','?kind=VENDOR&tenantId=spoof'])assert.equal((await request(path+suffix)).status,400,suffix);
  assert.equal(calls.length,1);
  const customer=await request(path+'?kind=CUSTOMER');assert.equal(customer.status,200);assert.equal(customer.body.data.status,'ACTIVE');
});
test('register rejects mismatched company, status, identity, order and cursor evidence',()=>{
  const scope={entityId,kind:'VENDOR',status:'ACTIVE',query:'',afterRef:null,limit:1},row={member_ref:'V-01',member_type:'VENDOR',display_name:'Vendor',active:true};
  const good={...page(scope),rows:[row],next_ref:'V-01'};assert.equal(validCounterpartyRegisterPage(good,scope),true);
  for(const bad of [{...good,entity_id:tenantId},{...good,status:'ALL'},{...good,rows:[{...row,active:false}]},{...good,rows:[{...row,member_type:'CUSTOMER'}]},{...good,rows:[row,row]},{...good,next_ref:'V-02'},{...good,can_edit:true}])assert.equal(validCounterpartyRegisterPage(bad,scope),false);
  assert.equal(validCounterpartyRegisterPage({...good,after_ref:'V-01'},{...scope,afterRef:'V-01'}),false);
});
test('register HTTP rejects command inputs and malformed backend response',async()=>{
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readCounterpartyRegister:async()=>({entity_id:tenantId})})});
  const req={method:'GET',url:path+'?kind=VENDOR',headers:{},body:null};assert.equal((await api(req)).status,500);
  for(const changes of [{body:{}},{headers:{'if-match':'"0"'}},{headers:{'idempotency-key':'unexpected'}}])assert.equal((await api({...req,...changes})).status,400);
});
