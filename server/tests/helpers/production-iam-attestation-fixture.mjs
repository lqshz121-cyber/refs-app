import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {grantProductionWorkflowRole} from '../../runtime/production-workflow-role-grant.mjs';
import {AUTHORITATIVE_WORKFLOW_ROLES,grantStagingWorkflowRole} from '../../runtime/workflow-role-grant.mjs';
import {OidcJwtAuthenticator,REFS_TENANT_CLAIM} from '../../api/oidc-authenticator.mjs';
import {grantStage1SelfReadAccess,grantStage1AuthenticatedReadAccess,STAGE1_READ_PERMISSIONS} from '../../runtime/stage1-bootstrap.mjs';

// All installation initialization is rolled back with this isolated fixture.
// Session authorization exercises actual database ACLs, not SET ROLE alone.
export async function productionIamAttestationFixture({adminPool,ids}){
  const client=await adminPool.connect(),installationId=randomUUID();
  const db=(await client.query('SELECT current_database() AS name')).rows[0].name;
  const initialize='SELECT refs_initialize_deployment_identity($1,$2,$3,$4) AS initialized';
  const initArgs=[installationId,'production',db,'INITIALIZE_IMMUTABLE_DEPLOYMENT_IDENTITY'];
  const assertion='SELECT refs_assert_deployment_identity($1,$2,$3) AS asserted';
  const assertArgs=[installationId,'production',db];
  const asRole=async role=>client.query(role==='migrator'?'RESET SESSION AUTHORIZATION':`SET SESSION AUTHORIZATION ${role}`);
  const denied=async(fn,code)=>{
    await client.query('SAVEPOINT denied_operation');
    try{await assert.rejects(fn,code?error=>error.code===code:undefined);}
    finally{await client.query('ROLLBACK TO SAVEPOINT denied_operation');await client.query('RELEASE SAVEPOINT denied_operation');}
  };
  const counts=async()=>{
    await asRole('migrator');
    const names=['refs_deployment_identity','runtime_actor_grant','runtime_actor_grant_set','runtime_grant_sync_receipt','runtime_auth_context','audit_event','outbox_event','idempotency_receipt','journal_entry','ledger_line'];
    return (await client.query(`SELECT ${names.map(name=>`(SELECT count(*)::int FROM ${name}) AS ${name}`).join(',')}`)).rows[0];
  };
  const pool={query:(...args)=>client.query(...args),connect:async()=>({release(){},query:(sql,args)=>sql==='SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'?Promise.resolve({rows:[],rowCount:0}):client.query(sql==='BEGIN'?'SAVEPOINT grant_ceremony':sql==='COMMIT'?'RELEASE SAVEPOINT grant_ceremony':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT grant_ceremony':sql,args)})};
  const definition=AUTHORITATIVE_WORKFLOW_ROLES.JE_SUBMITTER;
  const config={installationId,expectedDatabase:db,tenantId:ids.tenantId,entityId:ids.entityId,role:'JE_SUBMITTER',...definition,validUntil:new Date(Date.now()+3600000).toISOString(),expectedVersion:0,idempotencyKey:'production-iam-fixture-human',accessToken:''};
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const token=changes=>{
    const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture',typ:'JWT'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:'https://fixture.invalid',aud:'refs',sub:'fixture|production-submitter',iat:now,exp:now+1800,[REFS_TENANT_CLAIM]:ids.tenantId,...changes})).toString('base64url');
    return `${header}.${payload}.${sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url')}`;
  };
  let keyLookups=0;
  const authenticator=new OidcJwtAuthenticator({issuer:'https://fixture.invalid',audience:'refs',keyResolver:{resolve:async()=>{keyLookups++;return publicKey;}}});
  config.accessToken=token({});
  try{
    await client.query('BEGIN');
    const empty=await counts();
    await asRole('refs_grant_sync');
    await denied(()=>grantProductionWorkflowRole(pool,config,{authenticator}),'42501');
    assert.equal(keyLookups,0);assert.deepEqual(await counts(),empty);
    await asRole('refs_grant_sync');
    assert.equal((await client.query('SELECT refs_assert_staging_deployment_target(NULL,NULL) AS asserted')).rows[0].asserted,true);
    for(const role of ['refs_app','refs_runtime','refs_context_issuer','refs_grant_sync']){
      await asRole(role);
      await denied(()=>client.query(initialize,initArgs),'42501');
      await denied(()=>client.query('SELECT * FROM refs_deployment_identity'),'42501');
      await denied(()=>client.query('SELECT * FROM refs_deployment_identity_fence'),'42501');
      await denied(()=>client.query('UPDATE refs_deployment_identity_fence SET generation=0'),'42501');
      await denied(()=>client.query('INSERT INTO refs_deployment_identity(installation_id,deployment_environment,database_name) VALUES($1,$2,$3)',assertArgs),'42501');
      if(role!=='refs_grant_sync'){
        await denied(()=>client.query(assertion,assertArgs),'42501');
        await denied(()=>client.query('SELECT refs_assert_staging_deployment_target(NULL,NULL)'),'42501');
      }
    }
    await asRole('migrator');
    await denied(()=>client.query(initialize,[installationId,'production',db,'wrong']),'22023');
    // Staging cannot become production through caller configuration.
    await client.query('SAVEPOINT staging_identity');
    await client.query(initialize,[installationId,'staging',db,initArgs[3]]);
    await asRole('refs_grant_sync');
    await denied(()=>grantProductionWorkflowRole(pool,config,{authenticator}),'42501');
    await denied(()=>grantStagingWorkflowRole(pool,config,{authenticator}),'42501');
    assert.equal((await client.query('SELECT refs_assert_staging_deployment_target($1,$2) AS asserted',[installationId,db])).rows[0].asserted,true);
    await asRole('migrator');await client.query('ROLLBACK TO SAVEPOINT staging_identity');
    assert.equal((await client.query(initialize,initArgs)).rows[0].initialized,true);
    const retained=(await client.query('SELECT * FROM refs_deployment_identity')).rows;
    const retainedFence=(await client.query('SELECT generation,xmin::text FROM refs_deployment_identity_fence')).rows;
    assert.equal((await client.query(initialize,initArgs)).rows[0].initialized,false);
    for(const drift of [[randomUUID(),'production',db,initArgs[3]],[installationId,'staging',db,initArgs[3]],[installationId,'production','other_database',initArgs[3]]])await denied(()=>client.query(initialize,drift));
    for(const sql of ['UPDATE refs_deployment_identity SET deployment_environment=deployment_environment','DELETE FROM refs_deployment_identity','TRUNCATE refs_deployment_identity'])await denied(()=>client.query(sql),'42501');
    const down=(await readFile(new URL('../../db/migrations/down/301_deployment_identity_attestation.sql',import.meta.url),'utf8')).replace(/^\s*BEGIN;\s*/,'').replace(/\s*COMMIT;\s*$/,'');
    await denied(()=>client.query(down),'42501');
    assert.deepEqual((await client.query('SELECT * FROM refs_deployment_identity')).rows,retained);
    assert.deepEqual((await client.query('SELECT generation,xmin::text FROM refs_deployment_identity_fence')).rows,retainedFence);
    const before=await counts();
    await asRole('refs_grant_sync');
    await denied(()=>grantStagingWorkflowRole(pool,config,{authenticator}),'42501');
    await denied(()=>grantStagingWorkflowRole(pool,config,{installationId,expectedDatabase:db,authenticator}),'42501');
    const selfRead={...config,permissions:[...STAGE1_READ_PERMISSIONS],authorityClass:'ANALYSIS',actorId:'fixture|late-self-read'};
    // The same pool passed the uninitialized staging guard earlier; sealing
    // production must revoke that old startup assumption on the next call.
    await denied(()=>grantStage1SelfReadAccess(pool,selfRead),'42501');
    await denied(()=>grantStage1AuthenticatedReadAccess(pool,selfRead,{authenticator}),'42501');
    for(const changed of [{installationId:randomUUID()},{expectedDatabase:'other_database'}])await denied(()=>grantProductionWorkflowRole(pool,{...config,...changed},{authenticator}),'42501');
    assert.equal(keyLookups,0);
    for(const changed of [{accessToken:token({aud:'wrong'})},{accessToken:token({}).replace(/\.[^.]+$/,'.invalid_signature')},{accessToken:token({[REFS_TENANT_CLAIM]:randomUUID()})},{permissions:[...config.permissions,'GL.JE.POST']},{entityId:randomUUID()},{validUntil:new Date(Date.now()+25*3600000).toISOString()}])await denied(()=>grantProductionWorkflowRole(pool,{...config,...changed},{authenticator}));
    assert.deepEqual(await counts(),before);
    await asRole('refs_grant_sync');
    const granted=await grantProductionWorkflowRole(pool,config,{authenticator});
    assert.equal(granted.version,1);assert.equal(granted.idempotent,false);
    const replay=await grantProductionWorkflowRole(pool,config,{authenticator});assert.equal(replay.idempotent,true);
    const after=await counts();assert.equal(after.runtime_grant_sync_receipt,before.runtime_grant_sync_receipt+1);assert.equal(after.audit_event,before.audit_event+1);assert.equal(after.outbox_event,before.outbox_event+1);assert.equal(after.runtime_auth_context,before.runtime_auth_context);assert.equal(after.journal_entry,before.journal_entry);assert.equal(after.ledger_line,before.ledger_line);
    await asRole('refs_grant_sync');
    await denied(()=>grantProductionWorkflowRole(pool,{...config,idempotencyKey:'production-iam-stale-version'},{authenticator}));
    assert.deepEqual(await counts(),after);
    await asRole('refs_grant_sync');
    const replacement={...config,...AUTHORITATIVE_WORKFLOW_ROLES.JE_REVIEWER,role:'JE_REVIEWER',expectedVersion:1,idempotencyKey:'production-iam-exact-replace'};
    assert.equal((await grantProductionWorkflowRole(pool,replacement,{authenticator})).version,2);
    await asRole('migrator');
    const active=(await client.query('SELECT permission FROM runtime_actor_grant WHERE tenant_id=$1 AND actor_id=$2 AND entity_id=$3 AND revoked_at IS NULL ORDER BY permission',[ids.tenantId,'fixture|production-submitter',ids.entityId])).rows.map(row=>row.permission);
    assert.deepEqual(active,[...replacement.permissions].sort());
    const evidence=(await client.query("SELECT a.after_hash=r.request_hash AS audit_hash_matches, o.payload_hash=refs_jsonb_hash(o.payload) AS outbox_hash_matches FROM runtime_grant_sync_receipt r JOIN audit_event a ON a.tenant_id=r.tenant_id AND a.idempotency_key=r.idempotency_key JOIN outbox_event o ON o.tenant_id=r.tenant_id AND o.payload->>'actor_id'=r.actor_id AND (o.payload->>'version')::int=(r.response_body->>'version')::int WHERE r.idempotency_key=$1",[replacement.idempotencyKey])).rows;
    assert.deepEqual(evidence,[{audit_hash_matches:true,outbox_hash_matches:true}]);
    await asRole('refs_grant_sync');
    const service={...config,...AUTHORITATIVE_WORKFLOW_ROLES.OUTBOX_DISPATCHER_SERVICE,role:'OUTBOX_DISPATCHER_SERVICE',serviceActorId:'fixture|dedicated-outbox-service',idempotencyKey:'production-iam-service-only'};
    const lookupBeforeService=keyLookups;
    assert.equal((await grantProductionWorkflowRole(pool,service)).version,1);assert.equal(keyLookups,lookupBeforeService);
    const afterService=await counts();
    await asRole('refs_grant_sync');
    await denied(()=>grantProductionWorkflowRole(pool,{...service,permissions:['GL.JE.POST']}));
    assert.deepEqual(await counts(),afterService);
  }finally{await asRole('migrator');await client.query('ROLLBACK');client.release();}
}
