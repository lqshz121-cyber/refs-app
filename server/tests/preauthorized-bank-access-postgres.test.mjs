import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runtimeConfig} from '../runtime/config.mjs';
import {createPool} from '../runtime/db.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {createPreauthorizedBankAccess} from '../runtime/preauthorized-bank-access.mjs';
import {PostgresGrantSync} from '../runtime/grant-sync.mjs';
import {BANK_REQUEST_ACCOUNTING_VIEW_ROLE} from '../runtime/bank-request-settings-role.mjs';
import {createProductionAccountingServer} from '../runtime/accounting-server.mjs';

test('fixed staging preauthorization uses isolated grant login, CAS, replay and exact authority',async()=>{
  const database=runtimeConfig();
  for(const key of ['migrationDatabaseUrl','grantSyncDatabaseUrl']){
    const url=new URL(database[key]);
    assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
    assert.match(url.pathname,/_test$/);
  }
  const admin=await createPool({databaseUrl:database.migrationDatabaseUrl,max:1});
  const grants=await createPool({databaseUrl:database.grantSyncDatabaseUrl,max:1});
  const runtime=await createPool({databaseUrl:database.databaseUrl,max:1});
  const issuer=await createPool({databaseUrl:database.contextIssuerDatabaseUrl,max:1});
  let server;
  try{
    await migrateUp(admin,{});
    const tenantId=randomUUID(),entityId=randomUUID(),installationId=randomUUID(),actorId='owned-preauthorized-human';
    await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.slice(0,8)}`.toUpperCase(),'Owned preauthorization']);
    await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'WBPA','WBS','WBPA','WBPA','USD')",[entityId,tenantId]);
    const expectedDatabase=new URL(database.migrationDatabaseUrl).pathname.slice(1);
    const principal={trusted:true,tenantId,actorId};
    const config={tenantId,entityId,actorId,installationId,expectedDatabase,expectedVersion:0,validUntil:new Date(Date.now()+3600000).toISOString()};
    const activate=createPreauthorizedBankAccess({pool:grants,config,principal});
    const command={entityId,idempotencyKey:'owned-preauthorization-v1'};
    await assert.rejects(activate.describe({entityId}),error=>error.code==='42501');
    await assert.rejects(activate.activate(command),error=>error.code==='42501');
    assert.equal((await admin.query('SELECT count(*)::int n FROM runtime_actor_grant WHERE tenant_id=$1',[tenantId])).rows[0].n,0);
    await admin.query("SELECT refs_initialize_deployment_identity($1,'staging',$2,'INITIALIZE_IMMUTABLE_DEPLOYMENT_IDENTITY')",[installationId,expectedDatabase]);
    server=createProductionAccountingServer({runtimePool:runtime,issuerPool:issuer,grantSyncPool:grants,preauthorizedBankAccess:config,authenticator:{authenticate:async()=>principal}});
    await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
    const endpoint=`http://127.0.0.1:${server.address().port}/api/v1/entities/${entityId}/access/preauthorized-bank-read-grant`;
    const status=await fetch(endpoint);assert.equal(status.status,200);assert.equal(status.headers.get('cache-control'),'no-store');assert.equal((await status.json()).data.expectedVersion,0);
    const activation=await fetch(endpoint+'/activate',{method:'POST',headers:{'content-type':'application/json','idempotency-key':command.idempotencyKey},body:'{}'});
    assert.equal(activation.status,201);const first=(await activation.json()).data;
    assert.equal(first.version,1);assert.equal(first.permissionCount,10);assert.equal(first.idempotent,false);
    const replay=await activate.activate(command);
    assert.equal(replay.version,1);assert.equal(replay.idempotent,true);
    const rows=(await admin.query('SELECT permission,authority_class,valid_until FROM runtime_actor_grant WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3 AND revoked_at IS NULL',[tenantId,entityId,actorId])).rows;
    assert.deepEqual(rows.map(r=>r.permission).sort(),[...BANK_REQUEST_ACCOUNTING_VIEW_ROLE.permissions].sort());
    assert.ok(rows.every(r=>r.authority_class==='BANK_IMPORT_REQUEST'&&new Date(r.valid_until).toISOString()===config.validUntil));
    await assert.rejects(activate.activate({...command,idempotencyKey:'owned-stale-revision-v2'}));
    for(const change of [{installationId:randomUUID()},{expectedDatabase:'wrong_database_test'}])await assert.rejects(createPreauthorizedBankAccess({pool:grants,config:{...config,...change},principal}).activate({...command,idempotencyKey:'owned-wrong-target-v3'}));
    assert.throws(()=>createPreauthorizedBankAccess({pool:grants,config,principal:{...principal,actorId:'other-human'}}),{code:'PREAUTHORIZED_ACCESS_DENIED'});
    const sync=new PostgresGrantSync(grants,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
    await sync.reconcile({tenantId,entityId,actorId,permissions:[],authorityClass:'BANK_IMPORT_REQUEST',validUntil:config.validUntil,expectedVersion:1,idempotencyKey:'owned-preauthorization-revoke'});
    // A historic replay cannot reinstate a revoked grant.
    await activate.activate(command);
    assert.equal((await admin.query('SELECT count(*)::int n FROM runtime_actor_grant WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3 AND revoked_at IS NULL',[tenantId,entityId,actorId])).rows[0].n,0);
    for(const table of ['journal_entry','ledger_line','reconciliation'])assert.equal((await admin.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`,[tenantId])).rows[0].n,0);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await Promise.allSettled([admin.end(),grants.end(),runtime.end(),issuer.end()]);}
});
