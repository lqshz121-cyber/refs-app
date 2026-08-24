import {KernelError,requireRow,withSerializableRetry} from './db.mjs';

export class PostgresGrantSync{
  constructor(pool,{principalProvider}={}){
    if(typeof principalProvider!=='function')throw new KernelError('GRANT_SYNC_PRINCIPAL_REQUIRED','Grant sync requires authenticated service middleware');
    this.pool=pool;this.principalProvider=principalProvider;
  }

  async reconcile({tenantId,actorId,entityId,permissions=[],authorityClass,validUntil,expectedVersion,idempotencyKey}){
    const principal=await this.principalProvider();
    if(!principal||principal.trusted!==true||principal.serviceId!=='platform-iam-sync')throw new KernelError('GRANT_SYNC_PRINCIPAL_DENIED','Only the authenticated platform IAM sync service may reconcile grants');
    if(typeof authorityClass!=='string'||!authorityClass||validUntil===undefined)throw new KernelError('GRANT_SYNC_POLICY_REQUIRED','Grant authority class and expiry policy must be explicit');
    return withSerializableRetry(this.pool,async client=>{
      const identity=requireRow(await client.query('SELECT session_user,current_user'),'GRANT_SYNC_IDENTITY_MISSING','Grant sync DB identity missing');
      if(identity.session_user!=='refs_grant_sync'||identity.current_user!=='refs_grant_sync')throw new KernelError('GRANT_SYNC_DB_IDENTITY_DENIED','Grant sync requires its isolated database login');
      const hash=requireRow(await client.query('SELECT refs_grant_request_hash_v2($1,$2,$3,$4,$5,$6,$7) AS request_hash',[tenantId,actorId,entityId,permissions,authorityClass,validUntil,expectedVersion]),'GRANT_SYNC_HASH_FAILED','Canonical grant hash was not returned').request_hash;
      return requireRow(await client.query('SELECT refs_reconcile_actor_grants_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[tenantId,actorId,entityId,permissions,authorityClass,validUntil,expectedVersion,idempotencyKey,hash]),'GRANT_SYNC_FAILED','Grant reconcile did not return a result').result;
    });
  }
}
