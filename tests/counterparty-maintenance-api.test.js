import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {prepareCounterpartyCommand,sendCounterpartyCommand,readCounterpartyMaintenance} from '../src/counterparty-maintenance-api.js';
const config={baseUrl:'https://fixture.example',tenantId:'33333333-3333-4333-8333-333333333333',entityId:'11111111-1111-4111-8111-111111111111',periodId:'22222222-2222-4222-8222-222222222222',getAccessToken:async()=>'fixture-token-'.repeat(4)};
const body={kind:'VENDOR',memberRef:'V-1',changeType:'UPDATE',displayName:'Updated vendor',active:true,reason:'Update vendor name'};
const access={actor_id:'maker',tenant_id:config.tenantId,entity_id:config.entityId,grant_set_version:1,permissions:['MASTER.COUNTERPARTY.PROPOSE'],configured_permissions:['MASTER.COUNTERPARTY.PROPOSE'],session_refresh_required:false};
const receipt={counterparty_change_id:config.periodId,entity_id:config.entityId,member_ref:'V-1',kind:'VENDOR',status:'PENDING',revision:0,idempotent:false};
const prepared=()=>prepareCounterpartyCommand({config,actorId:'maker',body,expectedVersion:4,idempotencyKey:'counterparty-retry-1'}).command;
test('maintenance browser contracts remain identical to runtime validation',()=>{
 for(const [browser,server] of [['counterparty-maintenance-contract.js','counterparty-maintenance.mjs'],['counterparty-maintenance-read-contract.js','counterparty-maintenance-reads.mjs']])assert.equal(readFileSync(new URL('../src/'+browser,import.meta.url),'utf8'),readFileSync(new URL('../server/runtime/'+server,import.meta.url),'utf8'));
});
test('maintenance client rechecks actor and sends only closed body with exact version and stable replay key',async()=>{
 const command=prepared(),calls=[];
 const fetcher=async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({ok:true,data:url.endsWith('/access/self')?access:receipt})};};
 assert.equal((await sendCounterpartyCommand({config,command,fetcher})).ok,true);
 const post=calls.find(c=>c.init.method==='POST');assert.deepEqual(JSON.parse(post.init.body),body);assert.equal(post.init.headers['if-match'],'"4"');assert.equal(post.init.headers['idempotency-key'],'counterparty-retry-1');
 calls.length=0;
 const changedActor=async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({ok:true,data:{...access,actor_id:'another-user'}})};};
 assert.equal((await sendCounterpartyCommand({config,command,fetcher:changedActor})).ok,false);assert.equal(calls.filter(c=>c.init.method==='POST').length,0);
 assert.equal((await sendCounterpartyCommand({config:{...config,entityId:config.periodId},command,fetcher})).ok,false);
 const uncertain=async(url)=>url.endsWith('/access/self')?{ok:true,json:async()=>({ok:true,data:access})}:Promise.reject(Error('lost response'));
 assert.equal((await sendCounterpartyCommand({config,command,fetcher:uncertain})).unconfirmed,true);
 assert.equal(command.idempotencyKey,'counterparty-retry-1');assert.equal((await sendCounterpartyCommand({config,command,fetcher})).ok,true);
});
test('maintenance detail read returns only a matching authoritative revision',async()=>{
 const data={schema_version:'COUNTERPARTY_DETAIL_V1',entity_id:config.entityId,kind:'VENDOR',member_ref:'V-1',display_name:'Vendor',active:true,revision:4};
 let captured;const fetcher=async(url,init)=>(captured={url,init},{ok:true,json:async()=>({ok:true,data})});
 assert.equal((await readCounterpartyMaintenance({config,kind:'VENDOR',memberRef:'V-1',detail:true,fetcher})).ok,true);
 assert.equal(captured.init.method,'GET');assert.equal(captured.init.cache,'no-store');
 assert.equal((await readCounterpartyMaintenance({config,kind:'VENDOR',memberRef:'V-OTHER',detail:true,fetcher})).ok,false);
});
