// Serializable retries must not leave live capabilities behind.
//
// PostgresAccountingKernel.inSession issues a fresh context for every attempt
// (a capability binds to exactly one backend transaction). Under sixteen-way
// parallel reads the bootstrap writes to runtime_auth_context collide under
// SERIALIZABLE, attempts abort with 40001 and are retried - and before this
// change each aborted attempt left its context row unrevoked, unbound and
// valid until TTL (kernel #32 measured 134-140 rows for 128 reads). With a
// sessionRevoker wired, every attempt that fails before commit revokes the
// context it issued; the attempt that commits is never touched.

import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuerPool=null,unavailable=null;
before(async()=>{
  try{
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-ctx-revoke-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
    runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-ctx-revoke-runtime',max:20});await runtime.query('SELECT 1');
    issuerPool=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-ctx-revoke-issuer',max:8});await issuerPool.query('SELECT 1');
  }catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuerPool])if(p)await p.end().catch(()=>{});admin=runtime=issuerPool=null;}
});
after(async()=>{for(const p of [admin,runtime,issuerPool])if(p)await p.end();});

async function seedActor(actorId){
  const tenantId=randomUUID(),entityId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'ctx tenant']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,'GL.JE.VIEW','ANALYSIS',clock_timestamp()+interval '1 hour')",[tenantId,actorId,entityId]);
  return {tenantId,entityId};
}
function kernel(ids,actorId,{revoke}){
  const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>issuer.issue({tenantId:ids.tenantId}),
    ...(revoke?{sessionRevoker:(session,{reason})=>issuer.revoke({contextToken:session.contextToken,reason})}:{})});
}
const contexts=async(ids,actorId)=>(await admin.query(`SELECT count(*)::int total,
  count(*) FILTER (WHERE bound_backend_pid IS NOT NULL AND bound_txid IS NOT NULL)::int bound,
  count(*) FILTER (WHERE bound_backend_pid IS NULL)::int unbound,
  count(*) FILTER (WHERE bound_backend_pid IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp())::int live_unbound,
  count(*) FILTER (WHERE bound_backend_pid IS NOT NULL AND revoked_at IS NOT NULL)::int bound_but_revoked,
  count(*) FILTER (WHERE tenant_id<>$1)::int cross_tenant
  FROM runtime_auth_context WHERE actor_id=$2`,[ids.tenantId,actorId])).rows[0];

// Sixteen concurrent bootstraps per round: each attempt issues, binds (a write
// to runtime_auth_context) and reads. The bind is what collides under SSI.
async function hammer(k,rounds=8,width=16){
  let completed=0;
  for(let r=0;r<rounds;r++){
    const results=await Promise.all(Array.from({length:width},()=>k.inSession(async client=>(await client.query('SELECT refs_current_actor() actor')).rows[0].actor)));
    completed+=results.length;
  }
  return completed;
}
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

pgTest('with a session revoker, every attempt that failed before commit is revoked and no live unbound context survives; bound tokens are untouched',async()=>{
  const actorId='ctx-revoke-'+randomUUID().slice(0,8),ids=await seedActor(actorId);
  const completed=await hammer(kernel(ids,actorId,{revoke:true}));
  assert.equal(completed,128);
  const c=await contexts(ids,actorId);
  assert.equal(c.bound,128,'exactly one bound context per completed read');
  assert.equal(c.bound_but_revoked,0,'a token that reached commit is never revoked by the retry path');
  assert.equal(c.live_unbound,0,`every unbound context must be revoked (unbound=${c.unbound}, total=${c.total})`);
  assert.equal(c.cross_tenant,0);
  // Each revoke is audited on the issuer path.
  const audits=(await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type LIKE '%CONTEXT_REVOKED%'",[ids.tenantId])).rows[0].n;
  assert.equal(audits,c.unbound,'one audit row per revoked attempt');
  t_log(`retries observed: ${c.unbound} (total ${c.total} for 128 reads)`);
});

pgTest('without a revoker the baseline behaviour is reproduced: aborted attempts leave live unbound contexts (documents the defect the revoker closes)',async(t)=>{
  const actorId='ctx-baseline-'+randomUUID().slice(0,8),ids=await seedActor(actorId);
  await hammer(kernel(ids,actorId,{revoke:false}));
  const c=await contexts(ids,actorId);
  assert.equal(c.bound,128);assert.equal(c.cross_tenant,0);
  assert.equal(c.live_unbound,c.unbound,'baseline: unbound rows stay live until TTL');
  if(c.unbound===0)t.diagnostic('no serialization conflict occurred in this run; the baseline leak is timing-dependent');
});

pgTest('a rejected posting leaves no POST_JOURNAL idempotency receipt and its issued context is revoked',async()=>{
  const actorId='ctx-post-'+randomUUID().slice(0,8),ids=await seedActor(actorId);
  const k=kernel(ids,actorId,{revoke:true});
  // GL.JE.VIEW only: the post is refused by refs_assert_scope inside the transaction.
  await assert.rejects(k.postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:randomUUID(),journalEntryId:randomUUID(),expectedRevision:0,idempotencyKey:'ctx-post-denied'}),e=>e.code==='42501');
  assert.equal((await admin.query("SELECT count(*)::int n FROM idempotency_receipt WHERE tenant_id=$1 AND operation_scope LIKE 'POST_JOURNAL:%'",[ids.tenantId])).rows[0].n,0);
  const c=await contexts(ids,actorId);
  assert.equal(c.live_unbound,0,'the context issued for the refused attempt is revoked');
});
function t_log(m){console.log('# '+m);}
