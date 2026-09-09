import {PostgresContextIssuer} from '../../runtime/context-issuer.mjs';

export async function issueDuringGrantRefresh({adminPool,issuerPool,ids,actorId,revoke=false}){
  let pause,release,paused=false,principalCalls=0;
  const reached=new Promise(resolve=>{pause=resolve;});
  const released=new Promise(resolve=>{release=resolve;});
  const attemptedHashes=[];
  const controlledPool={connect:async()=>{
    const client=await issuerPool.connect();
    return {release:()=>client.release(),query:async(sql,args)=>{
      if(typeof sql==='string'&&sql.includes('refs_issue_context'))attemptedHashes.push(args[2]);
      const result=await client.query(sql,args);
      if(typeof sql==='string'&&sql.includes('refs_issue_context')&&!paused){paused=true;pause();await released;}
      return result;
    }};
  }};
  const counts=async()=>(await adminPool.query(`SELECT
    (SELECT count(*)::int FROM runtime_auth_context WHERE tenant_id=$1 AND actor_id=$2) contexts,
    (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND actor_id=$2 AND event_type='RUNTIME_CONTEXT_ISSUED') audits`,[ids.tenantId,actorId])).rows[0];
  const before=await counts();
  const issuer=new PostgresContextIssuer(controlledPool,{principalProvider:async()=>{principalCalls++;return {trusted:true,actorId};}});
  const pending=issuer.issue({tenantId:ids.tenantId}).then(value=>({value}),error=>({error}));
  let writerError,writer;
  try{
    await Promise.race([reached,pending.then(outcome=>{throw Error('Issuance finished before the grant race: '+String(outcome.error?.code));})]);
    writer=await adminPool.connect();
    await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await writer.query('SELECT count(*) FROM runtime_auth_context WHERE tenant_id=$1 AND actor_id=$2',[ids.tenantId,actorId]);
    await writer.query(revoke
      ?"UPDATE runtime_actor_grant SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3 AND permission='ATTACHMENT.CREATE'"
      :"UPDATE runtime_actor_grant SET valid_until=valid_until+interval '1 minute' WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3 AND permission='ATTACHMENT.CREATE'",
    [ids.tenantId,ids.entityId,actorId]);
    await writer.query('COMMIT');
  }catch(error){writerError=error;if(writer)await writer.query('ROLLBACK');}
  finally{writer?.release();release();}
  const outcome=await pending,after=await counts();
  return {outcome,writerError,before,after,attemptedHashes,principalCalls,
    diagnostic:{issueCode:outcome.error?.code,issueMessage:outcome.error?.message,writerCode:writerError?.code,before,after,attempts:attemptedHashes.length,principalCalls}};
}
