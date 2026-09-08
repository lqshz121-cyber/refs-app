import test from 'node:test';import assert from 'node:assert/strict';
import {prepareCounterpartyCommand} from '../src/counterparty-maintenance-api.js';
import {retainCounterpartyCommand,recoverCounterpartyCommand,releaseCounterpartyCommand} from '../src/counterparty-maintenance-recovery.js';
const config={baseUrl:'https://fixture.example',tenantId:'33333333-3333-4333-8333-333333333333',entityId:'11111111-1111-4111-8111-111111111111',periodId:'22222222-2222-4222-8222-222222222222',getAccessToken:async()=>'secret-token-never-retain'};
test('pending master changes survive module reload, isolate actor/company and never retain tokens',async()=>{
 const previous=globalThis.sessionStorage,values=new Map();globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 try{
  const scope={config,actorId:'maker'},command=prepareCounterpartyCommand({...scope,body:{kind:'VENDOR',memberRef:'V-1',changeType:'CREATE',displayName:'Vendor',active:true,reason:'Create vendor data'},idempotencyKey:'persisted-master-1'}).command;
  retainCounterpartyCommand(scope,command);assert.equal(values.size,1);assert.ok(![...values.values()][0].includes('secret-token'));
  const fresh=await import('../src/counterparty-maintenance-recovery.js?fresh-recovery-test');assert.deepEqual(fresh.recoverCounterpartyCommand(scope),command);
  assert.equal(recoverCounterpartyCommand({...scope,actorId:'another-maker'}),null);assert.equal(recoverCounterpartyCommand({...scope,config:{...config,entityId:config.periodId}}),null);
  assert.throws(()=>retainCounterpartyCommand(scope,{...command,idempotencyKey:'different-master-2'}),/earlier request/);
  releaseCounterpartyCommand(scope,{...command,idempotencyKey:'different-master-2'});assert.equal(values.size,1);
  releaseCounterpartyCommand(scope,command);assert.equal(values.size,0);assert.equal(recoverCounterpartyCommand(scope),null);
 }finally{globalThis.sessionStorage=previous;}
});
