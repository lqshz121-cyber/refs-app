import {KernelError} from './db.mjs';
import {runtimeConfig,databaseName} from './config.mjs';
import {workflowRolePolicyConfig,grantAuthenticatedWorkflowRole,grantConfiguredServiceWorkflowRole} from './workflow-role-grant.mjs';

export function productionWorkflowRoleGrantConfig(env=process.env){
  if(env.NODE_ENV!=='production'||env.REFS_DEPLOYMENT_ENV!=='production'||env.REFS_WORKFLOW_ROLE_CONFIRM!=='PRODUCTION_WORKFLOW_ROLE_ONLY')throw new KernelError('WORKFLOW_ROLE_ENV_DENIED','Explicit production ceremony required');
  const databases=runtimeConfig(env);
  const installationId=String(env.REFS_EXPECTED_INSTALLATION_ID||'');
  const expectedDatabase=String(env.REFS_EXPECTED_DATABASE_NAME||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId)||!expectedDatabase||expectedDatabase!==databaseName(databases.grantSyncDatabaseUrl))throw new KernelError('DEPLOYMENT_IDENTITY_CONFIG_INVALID','Exact expected installation and database required');
  const role=workflowRolePolicyConfig(env);
  return Object.freeze({...role,installationId,expectedDatabase,grantSyncDatabaseUrl:databases.grantSyncDatabaseUrl});
}

export async function grantProductionWorkflowRole(pool,config,options={}){
  const result=await pool.query('SELECT refs_assert_deployment_identity($1,$2,$3) AS asserted',[config.installationId,'production',config.expectedDatabase]);
  if(result.rows?.[0]?.asserted!==true)throw new KernelError('DEPLOYMENT_IDENTITY_DENIED','Database identity assertion failed');
  return config.principalKind==='SERVICE'?grantConfiguredServiceWorkflowRole(pool,config,options):grantAuthenticatedWorkflowRole(pool,config,options);
}
