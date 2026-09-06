import {createPool,KernelError} from '../runtime/db.mjs';
import {runtimeConfig,databaseName} from '../runtime/config.mjs';

let pool;
try{
  const env=process.env,config=runtimeConfig({...env,REFS_PG_REQUIRED:'1'});
  if(!['staging','production'].includes(env.REFS_DEPLOYMENT_ENV)||env.REFS_DEPLOYMENT_IDENTITY_CONFIRM!=='INITIALIZE_IMMUTABLE_DEPLOYMENT_IDENTITY'||env.REFS_EXPECTED_DATABASE_NAME!==databaseName(config.migrationDatabaseUrl))throw new KernelError('DEPLOYMENT_IDENTITY_CONFIG_INVALID','Exact database and explicit identity initialization confirmation required');
  pool=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-initialize-deployment-identity',max:1});
  const result=await pool.query('SELECT refs_initialize_deployment_identity($1,$2,$3,$4) AS initialized',[env.REFS_EXPECTED_INSTALLATION_ID,env.REFS_DEPLOYMENT_ENV,env.REFS_EXPECTED_DATABASE_NAME,env.REFS_DEPLOYMENT_IDENTITY_CONFIRM]);
  console.log(JSON.stringify({ok:true,operation:'initialize-deployment-identity',initialized:result.rows[0].initialized}));
}catch(error){console.error(`initialize-deployment-identity: ${error?.code||'FAILED'}`);process.exitCode=1;}
finally{if(pool)await pool.end().catch(()=>{});}
