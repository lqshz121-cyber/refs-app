import {createPool} from '../runtime/db.mjs';
import {productionWorkflowRoleGrantConfig,grantProductionWorkflowRole} from '../runtime/production-workflow-role-grant.mjs';

let pool;
try{
  const config=productionWorkflowRoleGrantConfig();
  pool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,applicationName:'refs-production-workflow-role-grant',max:1});
  const result=await grantProductionWorkflowRole(pool,config);
  console.log(JSON.stringify({ok:true,operation:'production-workflow-role-grant',...result}));
}catch(error){
  console.error(`production-workflow-role-grant: ${error?.code||'FAILED'}`);
  process.exitCode=1;
}finally{if(pool)await pool.end().catch(()=>{});}
