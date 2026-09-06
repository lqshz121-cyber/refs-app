import {createPool} from '../runtime/db.mjs';
import {assertStagingDeploymentTarget} from '../runtime/workflow-role-grant.mjs';
import {grantStage1AuthenticatedReadAccess,provisionStage1Scope,stage1AuthenticatedGrantConfig,stage1ProvisionConfig} from '../runtime/stage1-bootstrap.mjs';

const command=process.argv[2];
if(!['provision','grant'].includes(command)){
  console.error('stage1-bootstrap: USAGE_DENIED');
  process.exit(2);
}

let pool;
try{
  if(command==='provision'){
    const config=stage1ProvisionConfig();
    pool=await createPool({databaseUrl:process.env.MIGRATION_DATABASE_URL,applicationName:'refs-stage1-bootstrap',max:1});
    const result=await provisionStage1Scope(pool,config);
    console.log(JSON.stringify({ok:true,operation:'provision',idempotent:result.idempotent,tenant_count:result.tenantCount,entity_count:result.entityCount,period_count:result.periodCount,account_count:result.accountCount,audit_count:result.auditCount}));
  }else{
    const config=stage1AuthenticatedGrantConfig();
    pool=await createPool({databaseUrl:process.env.GRANT_SYNC_DATABASE_URL,applicationName:'refs-stage1-grant-sync',max:1});
    await assertStagingDeploymentTarget(pool,{installationId:process.env.REFS_EXPECTED_INSTALLATION_ID||null,expectedDatabase:process.env.REFS_EXPECTED_DATABASE_NAME||null});
    const result=await grantStage1AuthenticatedReadAccess(pool,{...config,installationId:process.env.REFS_EXPECTED_INSTALLATION_ID||null,expectedDatabase:process.env.REFS_EXPECTED_DATABASE_NAME||null});
    console.log(JSON.stringify({ok:true,operation:'grant',idempotent:result.idempotent,version:result.version,permission_count:result.permissionCount}));
  }
}catch(error){
  console.error(`stage1-bootstrap: ${error?.code||'FAILED'}`);
  process.exitCode=1;
}finally{
  if(pool)await pool.end().catch(()=>{});
}
