import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialReadSessionFactory} from '../runtime/initial-read-session.mjs';
const principal={trusted:true,actorId:'reader',tenantId:'configured-tenant'};
const missing=()=>Object.assign(new Error('Actor has no active DB authorization grant'),{code:'42501'});

test('simultaneous first page reads initialize once and each receive a fresh context',async()=>{
  let ready=false,initializations=0,contexts=0;
  const factory=createInitialReadSessionFactory({tenantId:principal.tenantId,initializeReadAccess:async args=>{assert.equal(args.actorId,principal.actorId);assert.match(args.idempotencyKey,/^initial-reader-/);initializations++;await new Promise(resolve=>setTimeout(resolve,10));ready=true;}});
  const issue=async()=>{if(!ready)throw missing();return {contextToken:`fresh-${++contexts}`};};
  const results=await Promise.all(Array.from({length:5},()=>factory({principal,issue})()));
  assert.equal(initializations,1);assert.equal(new Set(results.map(row=>row.contextToken)).size,5);
});

test('existing roles, wrong tenants, disabled setup and infrastructure denials never initialize',async()=>{
  let initialized=0;
  const factory=createInitialReadSessionFactory({tenantId:principal.tenantId,initializeReadAccess:async()=>{initialized++;}});
  assert.equal(await factory({principal,issue:async()=>'existing-role'})(),'existing-role');
  for(const message of ['Context issuer identity denied','Runtime context denied or expired','Tenant/entity scope denied','Permission AP.VIEW denied'])await assert.rejects(factory({principal,issue:async()=>{throw Object.assign(new Error(message),{code:'42501'});}})());
  await assert.rejects(factory({principal:{...principal,tenantId:'other'},issue:async()=>{throw missing();}})());
  await assert.rejects(createInitialReadSessionFactory()({principal,issue:async()=>{throw missing();}})());
  assert.equal(initialized,0);
});

test('failed initialization releases its pending entry and unsuccessful context retry does not loop',async()=>{
  let attempts=0;
  const factory=createInitialReadSessionFactory({tenantId:principal.tenantId,initializeReadAccess:async()=>{attempts++;throw new Error('setup unavailable');}});
  for(let n=0;n<2;n++)await assert.rejects(factory({principal,issue:async()=>{throw missing();}})(),/setup unavailable/);
  assert.equal(attempts,2);
  let calls=0;
  const retry=createInitialReadSessionFactory({tenantId:principal.tenantId,initializeReadAccess:async()=>{}});
  await assert.rejects(retry({principal,issue:async()=>{calls++;throw missing();}})());assert.equal(calls,2);
});
