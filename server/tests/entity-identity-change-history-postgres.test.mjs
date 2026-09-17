// O11: 427 — entity identity changes are recorded (who: db session user + REFS actor when present; what: name hash,
// binding, active; when), a BASELINE fingerprint exists for every pre-existing entity, the history is append-only,
// the read model exposes hashes/lengths but never names, and the migration changes no name.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
const config=runtimeConfig();const sha=v=>`sha256:${createHash('sha256').update(v,'utf8').digest('hex')}`;
let admin=null,runtime=null,issuer=null,unavailable=null;
before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-o11-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-o11-runtime',max:2});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-o11-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};

pgTest('a direct UPDATE of entity.name by the migrator is recorded with session user, hashes and transaction; names never enter the read model',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),code=`O11${randomUUID().slice(0,4).toUpperCase()}`;
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'o11']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$4,'USD')",[entityId,tenantId,code,`WBS ${code}`]);
  // insert is not a change; the baseline covers only rows that existed at migration time
  assert.equal((await admin.query('SELECT count(*)::int n FROM entity_identity_change WHERE entity_id=$1',[entityId])).rows[0].n,0);
  await admin.query('UPDATE entity SET name=$2 WHERE entity_id=$1',[entityId,'Real Company Name LLC']);
  await admin.query("UPDATE entity SET source_system='REFS_STAGE1',source_entity_id='X' WHERE entity_id=$1",[entityId]);
  await admin.query('UPDATE entity SET base_currency=base_currency WHERE entity_id=$1',[entityId]); // no identity change → no row
  const rows=(await admin.query('SELECT change_kind,db_session_user,refs_actor,name_before,name_after,name_after_sha256,source_system_before,source_system_after,transaction_id FROM entity_identity_change WHERE entity_id=$1 ORDER BY changed_at',[entityId])).rows;
  assert.equal(rows.length,2);
  assert.deepEqual({k:rows[0].change_kind,u:rows[0].db_session_user,b:rows[0].name_before,a:rows[0].name_after,h:rows[0].name_after_sha256},{k:'UPDATE',u:'refs_migrator',b:`WBS ${code}`,a:'Real Company Name LLC',h:sha('Real Company Name LLC')});
  assert.equal(rows[0].refs_actor,null,'a migrator session has no REFS actor');
  assert.deepEqual({b:rows[1].source_system_before,a:rows[1].source_system_after},{b:'WBS',a:'REFS_STAGE1'});
  assert.ok(rows[0].transaction_id>0n||Number(rows[0].transaction_id)>0);
  // append-only
  await assert.rejects(admin.query('DELETE FROM entity_identity_change WHERE entity_id=$1',[entityId]),e=>e.code==='55000');
  await assert.rejects(admin.query("UPDATE entity_identity_change SET name_after='x' WHERE entity_id=$1",[entityId]),e=>e.code==='55000');
  // read model: scoped, paged, hashes only
  const a=(await admin.query("SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code='GL.REPORT.VIEW'")).rows[0]?.authority_class||'ANALYSIS';
  await admin.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,'o11-reader',$2,'GL.REPORT.VIEW',$3,clock_timestamp()+interval '1 hour')",[tenantId,entityId,a]);
  const kernel=kernelFor({tenantId,entityId},'o11-reader');
  const read=await kernel.inSession(c=>c.query('SELECT refs_read_entity_identity_changes($1,$2,50,0) AS r',[tenantId,entityId]));
  const r=read.rows[0].r;assert.equal(r.schema_version,'ENTITY_IDENTITY_CHANGES_V1');assert.equal(r.total,2);assert.equal(r.rows.length,2);
  const text=JSON.stringify(r);assert.equal(text.includes('Real Company Name'),false);assert.equal(text.includes(`WBS ${code}`),false);
  assert.equal(r.rows[1].name_after_sha256,sha('Real Company Name LLC'));assert.equal(r.rows[1].name_after_length,'Real Company Name LLC'.length);assert.equal(r.rows[1].name_before_sha256,sha(`WBS ${code}`));
  await assert.rejects(kernelFor({tenantId,entityId},'o11-stranger').inSession(c=>c.query('SELECT refs_read_entity_identity_changes($1,$2,50,0)',[tenantId,entityId])),e=>e.code==='42501');
});

pgTest('the migration wrote a BASELINE fingerprint for pre-existing entities, changed no name, and its down file removes only its own objects',async()=>{
  const baseline=(await admin.query("SELECT count(*)::int n FROM entity_identity_change WHERE change_kind='BASELINE'")).rows[0].n;
  const entities=(await admin.query("SELECT count(*)::int n FROM entity WHERE created_at<(SELECT min(changed_at) FROM entity_identity_change WHERE change_kind='BASELINE')")).rows[0].n;
  assert.ok(baseline>=entities,`baseline ${baseline} covers the ${entities} entities that pre-dated the migration`);
  const mismatch=(await admin.query("SELECT count(*)::int n FROM entity_identity_change b JOIN entity e USING(tenant_id,entity_id) WHERE b.change_kind='BASELINE' AND b.name_after_sha256<>'sha256:'||encode(sha256(convert_to(e.name,'UTF8')),'hex') AND NOT EXISTS(SELECT 1 FROM entity_identity_change u WHERE u.entity_id=e.entity_id AND u.change_kind='UPDATE')")).rows[0].n;
  assert.equal(mismatch,0,'every unchanged entity still matches its baseline fingerprint');
  const down=await readFile(new URL('../db/migrations/down/427_entity_identity_change_history.sql',import.meta.url),'utf8');
  assert.match(down,/DROP TABLE IF EXISTS entity_identity_change/);assert.doesNotMatch(down,/UPDATE entity SET|DELETE FROM entity\b/);
});
