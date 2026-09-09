import test from 'node:test';import assert from 'node:assert/strict';
import {readCounterpartyRegister} from '../src/counterparty-register-api.js';
const config={baseUrl:'https://fixture.example',entityId:'11111111-1111-4111-8111-111111111111',periodId:'22222222-2222-4222-8222-222222222222',getAccessToken:async()=>'fixture-token-'.repeat(4)};
const data={schema_version:'COUNTERPARTY_REGISTER_V1',entity_id:config.entityId,kind:'VENDOR',status:'ACTIVE',query:'',after_ref:null,limit:25,rows:[{member_ref:'V-1',member_type:'VENDOR',display_name:'Vendor',active:true}],next_ref:null};
test('register client sends authenticated GET and verifies company data',async()=>{
  let call;const r=await readCounterpartyRegister({config,kind:'VENDOR',fetcher:async(url,init)=>(call={url,init},{ok:true,json:async()=>({ok:true,data})})});
  assert.equal(r.ok,true);assert.equal(call.init.method,'GET');assert.equal(call.init.cache,'no-store');assert.equal(call.init.body,undefined);assert.ok(call.init.headers.authorization.startsWith('Bearer '));
  assert.equal(new URL(call.url).searchParams.get('status'),'ACTIVE');
  for(const changed of [{...data,entity_id:config.periodId},{...data,rows:[{...data.rows[0],active:false}]},{...data,next_ref:'WRONG'}])assert.equal((await readCounterpartyRegister({config,kind:'VENDOR',fetcher:async()=>({ok:true,json:async()=>({ok:true,data:changed})})})).ok,false);
});
test('register client rejects bad filters without issuing requests and contains transport failures',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw Error('network');};
  assert.equal((await readCounterpartyRegister({config,kind:'UNKNOWN',fetcher})).ok,false);assert.equal(calls,0);
  assert.equal((await readCounterpartyRegister({config,kind:'VENDOR',fetcher})).ok,false);assert.equal(calls,1);
});
