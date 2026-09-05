import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../../runtime/db.mjs';
import {migrateUp} from '../../runtime/migrations.mjs';
import {PostgresGrantSync} from '../../runtime/grant-sync.mjs';
import {AUTHORITATIVE_WORKFLOW_ROLES,assertStagingDeploymentTarget,grantStagingWorkflowRole} from '../../runtime/workflow-role-grant.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const principalProvider=async()=>({trusted:true,serviceId:'platform-iam-sync'});

export async function productionIamSealRaceFixture({adminPool,config}){
  const name=`refs_iam_race_${randomUUID().replaceAll('-','').slice(0,16)}_test`;
  assert.match(name,/^refs_iam_race_[0-9a-f]{16}_test$/);
  const urlFor=value=>{const url=new URL(value);url.pathname=`/${name}`;return url.toString();};
  const envNames={DATABASE_URL:'databaseUrl',MIGRATION_DATABASE_URL:'migrationDatabaseUrl',CONTEXT_ISSUER_DATABASE_URL:'contextIssuerDatabaseUrl',GRANT_SYNC_DATABASE_URL:'grantSyncDatabaseUrl'};
  let ownerPool,grantPool,owner,oldSnapshot,sealPending,grantPending,inflight;
  const proceedGrant=deferred(),proceedOidc=deferred();
  const parentDatabase=(await adminPool.query('SELECT current_database() AS name')).rows[0].name;
  assert.match(parentDatabase,/_test$/,'race fixtures require an explicitly isolated test database');
  await adminPool.query(`CREATE DATABASE "${name}"`);
  try{
    ownerPool=await createPool({databaseUrl:urlFor(config.migrationDatabaseUrl),applicationName:'refs-iam-race-owner',max:3,statementTimeoutMs:600000});
    grantPool=await createPool({databaseUrl:urlFor(config.grantSyncDatabaseUrl),applicationName:'refs-iam-race-grant',max:3});
    // Migration runner verifies its real DB against configured URLs. Restore
    // the test runner's environment immediately after this isolated upgrade.
    const saved=Object.fromEntries(Object.keys(envNames).map(key=>[key,process.env[key]]));
    try{
      for(const [key,field] of Object.entries(envNames))process.env[key]=urlFor(config[field]);
      await migrateUp(ownerPool);
    }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
    const tenantId=randomUUID(),entityId=randomUUID();
    await ownerPool.query("INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,'IAM_RACE','Isolated IAM race fixture')",[tenantId]);
    await ownerPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_entity_id,name,base_currency) VALUES($1,$2,'IAM_RACE','IAM_RACE','Isolated IAM race fixture','USD')",[entityId,tenantId]);
    const inputs={tenantId,entityId,actorId:'fixture|race-before-seal',permissions:['GL.JE.SUBMIT'],authorityClass:'SUBMIT',validUntil:new Date(Date.now()+3600000).toISOString(),expectedVersion:0,idempotencyKey:'iam-race-before-seal'};
    const sealSql='SELECT refs_initialize_deployment_identity($1,$2,$3,$4) AS initialized';
    const sealArgs=[randomUUID(),'production',name,'INITIALIZE_IMMUTABLE_DEPLOYMENT_IDENTITY'];
    const counts=async()=>{
      const tables=['runtime_actor_grant','runtime_actor_grant_set','runtime_grant_sync_receipt','runtime_auth_context','audit_event','outbox_event','idempotency_receipt','journal_entry','ledger_line'];
      return (await ownerPool.query(`SELECT ${tables.map(table=>`(SELECT count(*)::int FROM ${table}) AS ${table}`).join(',')}`)).rows[0];
    };

    // Direction 1: a guarded mutation owns SHARE until its real COMMIT. The
    // second physical session must be observed waiting on initializer's lock.
    const guarded=deferred(),events=[];
    const sync=new PostgresGrantSync(grantPool,{principalProvider,transactionGuard:async client=>{
      await assertStagingDeploymentTarget(client);guarded.resolve();await proceedGrant.promise;
    }});
    grantPending=sync.reconcile(inputs).then(result=>{events.push('grant-committed');return result;});
    await Promise.race([guarded.promise,grantPending.then(()=>{throw new Error('grant completed before the barrier');})]);
    owner=await ownerPool.connect();await owner.query('BEGIN');
    const ownerPid=(await owner.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    sealPending=owner.query(sealSql,sealArgs).then(result=>{events.push('seal-inserted');return result;});
    // Attach failure observers immediately while the intentional barrier waits.
    sealPending.catch(()=>{});grantPending.catch(()=>{});
    const deadline=Date.now()+4000;let waiting=false;
    while(Date.now()<deadline){
      waiting=(await ownerPool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='public.refs_deployment_identity'::regclass AND mode='ExclusiveLock' AND NOT granted) AS waiting",[ownerPid])).rows[0].waiting;
      if(waiting)break;await new Promise(done=>setTimeout(done,10));
    }
    assert.equal(waiting,true,'initializer must wait for the grant transaction identity SHARE lock');
    assert.deepEqual(events,[]);proceedGrant.resolve();
    assert.equal((await grantPending).version,1);await sealPending;
    assert.deepEqual([...events].sort(),['grant-committed','seal-inserted']);
    assert.equal((await owner.query('SELECT count(*)::int AS count FROM runtime_grant_sync_receipt WHERE idempotency_key=$1',[inputs.idempotencyKey])).rows[0].count,1,'initializer can proceed only after the guarded grant committed');
    await owner.query('ROLLBACK');owner.release();owner=null;
    assert.equal((await ownerPool.query('SELECT count(*)::int AS count FROM refs_deployment_identity')).rows[0].count,0);

    // Direction 2: pre-OIDC guard succeeded, but production seals while OIDC is
    // in flight. A separate old SERIALIZABLE snapshot must also fail 40001
    // rather than reading the formerly empty identity after waiting for a lock.
    oldSnapshot=await grantPool.connect();
    await oldSnapshot.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await oldSnapshot.query('SELECT refs_current_actor_grant_set_version($1,$2,$3)',[tenantId,inputs.actorId,entityId]);
    const reachedOidc=deferred();
    const roleConfig={...inputs,...AUTHORITATIVE_WORKFLOW_ROLES.JE_SUBMITTER,role:'JE_SUBMITTER',idempotencyKey:'iam-race-oidc-after-seal'};
    inflight=grantStagingWorkflowRole(grantPool,roleConfig,{authenticator:{authenticate:async()=>{reachedOidc.resolve();await proceedOidc.promise;return {tenantId,actorId:'fixture|race-after-seal'};}}});
    inflight.catch(()=>{});await Promise.race([reachedOidc.promise,inflight.then(()=>{throw new Error('ceremony completed before OIDC barrier');})]);
    const beforeSeal=await counts();
    await ownerPool.query(sealSql,sealArgs); // Commit on the independent owner connection.
    await assert.rejects(assertStagingDeploymentTarget(oldSnapshot),error=>error.code==='40001');
    await oldSnapshot.query('ROLLBACK');oldSnapshot.release();oldSnapshot=null;
    proceedOidc.resolve();await assert.rejects(inflight,error=>error.code==='42501');
    const deniedSync=new PostgresGrantSync(grantPool,{principalProvider,transactionGuard:client=>assertStagingDeploymentTarget(client)});
    await assert.rejects(deniedSync.reconcile({...inputs,actorId:'fixture|race-retry',idempotencyKey:'iam-race-retry-after-seal'}),error=>error.code==='42501');
    await assert.rejects(deniedSync.currentVersion(inputs),error=>error.code==='42501');
    assert.deepEqual(await counts(),beforeSeal,'all post-seal failed ceremonies have zero grant, audit, outbox, context, idempotency or accounting effects');
  }finally{
    proceedGrant.resolve();proceedOidc.resolve();
    await Promise.allSettled([grantPending,sealPending,inflight].filter(Boolean));
    if(oldSnapshot){await oldSnapshot.query('ROLLBACK').catch(()=>{});oldSnapshot.release();}
    if(owner){await owner.query('ROLLBACK').catch(()=>{});owner.release();}
    await Promise.allSettled([grantPool?.end(),ownerPool?.end()]);
    // Only this helper's generated, validated database is removed; the parent
    // fixture database and all unrelated databases remain untouched.
    await adminPool.query(`DROP DATABASE "${name}"`);
  }
}
