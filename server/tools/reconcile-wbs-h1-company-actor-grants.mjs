#!/usr/bin/env node
// Staging-only: reconcile the finite WBS H1 workflow grants for the configured test actors on EVERY
// active WBS company entity of the tenant, so import-wbs-h1-all-companies.mjs,
// apply-wbs-h1-payable-mappings.mjs and decide-wbs-h1-accounting-settings.mjs can run across all
// companies instead of only the startup template entity (reconcileWbsTestImportActorGrants covers one).
//
// It uses the same isolated refs_grant_sync path and the same frozen per-role bundles as the API
// startup bootstrap; nothing is inserted directly into runtime_actor_grant. Human-class grants are
// finite (REFS_WBS_H1_GRANT_HOURS, default 12, max 23) and are simply re-run before the next batch.
//
//   REFS_WBS_H1_GRANT_HOURS=12 node tools/reconcile-wbs-h1-company-actor-grants.mjs
//   REFS_WBS_H1_GRANT_COMPANY=OPML node tools/reconcile-wbs-h1-company-actor-grants.mjs   (one company)
//   REFS_WBS_H1_GRANT_ROLES=maker,submitter,reviewer,approver,poster,settingsController      (subset)
//
// Required env (all already present on refs-accounting-api-staging): GRANT_SYNC_DATABASE_URL,
// MIGRATION_DATABASE_URL, REFS_WBS_TEST_IMPORT_TENANT_ID and REFS_WBS_TEST_IMPORT_<ROLE>_ACTOR_ID for
// every selected role. The optional settingsController role reads
// REFS_WBS_TEST_IMPORT_SETTINGS_CONTROLLER_ACTOR_ID and receives exactly the frozen
// WBS_H1_SETTINGS_CONTROLLER bundle (read set + WBS.H1.SETTINGS.DECIDE).
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {PostgresGrantSync} from '../runtime/grant-sync.mjs';
import {assertStagingDeploymentTarget,AUTHORITATIVE_WORKFLOW_ROLES} from '../runtime/workflow-role-grant.mjs';
import {WBS_TEST_IMPORT_GRANT_BUNDLES} from '../runtime/wbs-test-import-service.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const ACTOR=/^[^\u0000-\u001f\u007f]{1,200}$/;

// Same authority classes as reconcileWbsTestImportActorGrants (runtime/wbs-test-import-service.mjs).
const TEST_IMPORT_AUTHORITY=Object.freeze({importer:'SERVICE',reconciliationStarter:'DRAFT',maker:'DRAFT',paymentMaker:'PAYMENT',matchMaker:'DRAFT',submitter:'SUBMIT',reviewer:'REVIEW',approver:'APPROVE',poster:'POST',clearer:'DRAFT',reopener:'REOPEN'});
const ENV_ROLE=Object.freeze({reconciliationStarter:'RECONCILIATION_STARTER',paymentMaker:'PAYMENT_MAKER',matchMaker:'MATCH_MAKER',settingsController:'SETTINGS_CONTROLLER'});
const DEFAULT_ROLES=Object.freeze(['importer','maker','submitter','reviewer','approver','poster']);

export function wbsH1RoleBundle(role){
  if(role==='settingsController'){
    const definition=AUTHORITATIVE_WORKFLOW_ROLES.WBS_H1_SETTINGS_CONTROLLER;
    return Object.freeze({authorityClass:definition.authorityClass,permissions:[...definition.permissions]});
  }
  const permissions=WBS_TEST_IMPORT_GRANT_BUNDLES[role],authorityClass=TEST_IMPORT_AUTHORITY[role];
  if(!permissions||!authorityClass)throw new Error(`Unknown WBS H1 actor role ${role}`);
  return Object.freeze({authorityClass,permissions:[...permissions]});
}

export function selectWbsH1GrantRoles(value){
  const roles=String(value||DEFAULT_ROLES.join(',')).split(',').map(item=>item.trim()).filter(Boolean);
  if(!roles.length||new Set(roles).size!==roles.length)throw new Error('REFS_WBS_H1_GRANT_ROLES must list distinct roles');
  for(const role of roles)wbsH1RoleBundle(role);
  return Object.freeze(roles);
}

export function wbsH1GrantExpiry(hoursValue,now=Date.now()){
  const hours=Number(hoursValue??12);
  if(!Number.isSafeInteger(hours)||hours<1||hours>23)throw new Error('REFS_WBS_H1_GRANT_HOURS must be an integer between 1 and 23');
  return new Date(now+hours*60*60*1000).toISOString();
}

export async function reconcileWbsH1CompanyActorGrants({grantSync,tenantId,entities,actors,roles,humanValidUntil,onProgress=()=>{}}){
  if(typeof grantSync?.reconcile!=='function'||typeof grantSync?.currentVersion!=='function')throw new Error('Grant sync is unavailable');
  if(!UUID.test(tenantId||''))throw new Error('Tenant must be a UUID');
  if(!Array.isArray(entities)||!entities.length||entities.some(row=>!UUID.test(row?.entity_id||'')||!COMPANY.test(row?.company_code||'')))throw new Error('WBS entity list is invalid');
  if(!Array.isArray(roles)||!roles.length)throw new Error('No roles selected');
  const actorIds=roles.map(role=>actors[role]);
  if(actorIds.some(actorId=>typeof actorId!=='string'||!ACTOR.test(actorId))||new Set(actorIds).size!==actorIds.length)throw new Error('WBS H1 actor ids must be present and distinct');
  const summary={status:'WBS_H1_COMPANY_GRANTS_RECONCILED',entity_count:entities.length,role_count:roles.length,reconciled:0,idempotent:0,failed:0,valid_until:humanValidUntil,failures:[]};
  for(const entity of entities){
    for(const role of roles){
      const bundle=wbsH1RoleBundle(role),actorId=actors[role],validUntil=bundle.authorityClass==='SERVICE'?null:humanValidUntil;
      let completed=false,lastError=null;
      for(let attempt=0;attempt<3&&!completed;attempt++){
        const expectedVersion=await grantSync.currentVersion({tenantId,entityId:entity.entity_id,actorId});
        try{
          const result=await grantSync.reconcile({tenantId,entityId:entity.entity_id,actorId,permissions:bundle.permissions,authorityClass:bundle.authorityClass,validUntil,expectedVersion,idempotencyKey:`wbs-h1-company-${role}-grant-v1-${entity.company_code}-${expectedVersion}-${(validUntil||'service').slice(0,13).replace(/[-:T]/g,'')}`});
          completed=true;summary.reconciled++;if(result?.idempotent===true)summary.idempotent++;
        }catch(error){lastError=error;if(error?.code!=='40001'||attempt===2)break;}
      }
      if(!completed){summary.failed++;summary.failures.push({company_code:entity.company_code,role,code:lastError?.code||'UNEXPECTED',message:lastError?.message||'unknown'});onProgress({status:'WBS_H1_COMPANY_GRANT_FAILED',company_code:entity.company_code,role,code:lastError?.code||'UNEXPECTED'});}
    }
    onProgress({status:'WBS_H1_COMPANY_GRANTS_DONE',company_code:entity.company_code,entity_id:entity.entity_id});
  }
  if(summary.failed)summary.status='WBS_H1_COMPANY_GRANTS_PARTIAL';
  return Object.freeze(summary);
}

async function main(){
  for(const key of ['GRANT_SYNC_DATABASE_URL','MIGRATION_DATABASE_URL','REFS_WBS_TEST_IMPORT_TENANT_ID'])if(!process.env[key])throw new Error(`${key} is required`);
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID;
  if(!UUID.test(tenantId))throw new Error('REFS_WBS_TEST_IMPORT_TENANT_ID must be a UUID');
  const roles=selectWbsH1GrantRoles(process.env.REFS_WBS_H1_GRANT_ROLES);
  const actors={};
  for(const role of roles){
    const key=`REFS_WBS_TEST_IMPORT_${ENV_ROLE[role]||role.toUpperCase()}_ACTOR_ID`;
    if(!process.env[key])throw new Error(`${key} is required`);
    actors[role]=process.env[key];
  }
  const companyCode=process.env.REFS_WBS_H1_GRANT_COMPANY?.trim().toUpperCase()||null;
  if(companyCode!==null&&!COMPANY.test(companyCode))throw new Error('REFS_WBS_H1_GRANT_COMPANY is invalid');
  const humanValidUntil=wbsH1GrantExpiry(process.env.REFS_WBS_H1_GRANT_HOURS);
  const target={installationId:process.env.REFS_EXPECTED_INSTALLATION_ID||null,expectedDatabase:process.env.REFS_EXPECTED_DATABASE_NAME||null};
  const [scopePool,grantPool]=await Promise.all([
    createPool({databaseUrl:process.env.MIGRATION_DATABASE_URL,applicationName:'refs-wbs-h1-company-grants-scope',max:1}),
    createPool({databaseUrl:process.env.GRANT_SYNC_DATABASE_URL,applicationName:'refs-wbs-h1-company-grants-sync',max:1})
  ]);
  try{
    await assertStagingDeploymentTarget(grantPool,target);
    const entities=(await scopePool.query(`SELECT entity_id::text,entity_code AS company_code FROM entity
      WHERE tenant_id=$1 AND active AND source_system='WBS' AND source_entity_id=entity_code AND ($2::text IS NULL OR entity_code=$2)
      ORDER BY entity_code`,[tenantId,companyCode])).rows;
    if(!entities.length)throw new Error('No active WBS company entity matched');
    const grantSync=new PostgresGrantSync(grantPool,{principalProvider:async()=>{await assertStagingDeploymentTarget(grantPool,target);return {trusted:true,serviceId:'platform-iam-sync'};},transactionGuard:client=>assertStagingDeploymentTarget(client,target)});
    const summary=await reconcileWbsH1CompanyActorGrants({grantSync,tenantId,entities,actors,roles,humanValidUntil,onProgress:row=>{if(row.status!=='WBS_H1_COMPANY_GRANTS_DONE')process.stdout.write(`${JSON.stringify(row)}\n`);}});
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if(summary.failed)process.exitCode=1;
  }finally{await Promise.allSettled([scopePool.end(),grantPool.end()]);}
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_COMPANY_GRANTS_FAILED',code:error?.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
