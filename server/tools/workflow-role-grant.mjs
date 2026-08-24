import {createPool} from '../runtime/db.mjs';
import {authoritativeWorkflowRoleGrantConfig,grantAuthenticatedWorkflowRole,grantConfiguredServiceWorkflowRole} from '../runtime/workflow-role-grant.mjs';

let pool;
try{
  const config=authoritativeWorkflowRoleGrantConfig();
  pool=await createPool({databaseUrl:process.env.GRANT_SYNC_DATABASE_URL,applicationName:'refs-workflow-role-grant',max:1});
  const result=config.principalKind==='SERVICE'?await grantConfiguredServiceWorkflowRole(pool,config):await grantAuthenticatedWorkflowRole(pool,config);
  console.log(JSON.stringify({ok:true,operation:'workflow-role-grant',role:result.role,idempotent:result.idempotent,version:result.version,permission_count:result.permissionCount}));
}catch(error){
  console.error(`workflow-role-grant: ${error?.code||'FAILED'}`);
  process.exitCode=1;
}finally{
  if(pool)await pool.end().catch(()=>{});
}
