#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {createWbsLivePilotClient,createWbsLivePilotReadService} from '../runtime/wbs-live-pilot-read-service.mjs';
import {createWbsTestImportService} from '../runtime/wbs-test-import-service.mjs';
import {stageWbsH1PayableMappingRawPageForTestImport} from './stage-wbs-h1-payable-mapping-source.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const MONTHS=Object.freeze(Array.from({length:6},(_,index)=>`2026-${String(index+1).padStart(2,'0')}`));
const ACTORS=Object.freeze(['importer','maker','submitter','reviewer','approver','poster']);

const monthEnd=periodCode=>new Date(Date.UTC(2026,Number(periodCode.slice(5,7)),0)).toISOString().slice(0,10);
const idempotencyKey=(companyCode,periodCode)=>`wbs-h1:${createHash('sha256').update(companyCode,'utf8').digest('hex').slice(0,24)}:${periodCode}`;
const integer=(value,name,{min,max})=>{
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
};

export function selectWbsH1CompanyBatch(companies,{companyCode=null,startAfter=null,limit=10}={}){
  if(!Array.isArray(companies)||companies.some(row=>!UUID.test(row?.entity_id||'')||!COMPANY.test(row?.company_code||'')))throw new Error('WBS H1 company scope list is invalid');
  if(companyCode!==null&&!COMPANY.test(companyCode)||startAfter!==null&&!COMPANY.test(startAfter)||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error('WBS H1 company batch selection is invalid');
  const ordered=[...companies].sort((left,right)=>left.company_code.localeCompare(right.company_code));
  if(new Set(ordered.map(row=>row.company_code)).size!==ordered.length||new Set(ordered.map(row=>row.entity_id)).size!==ordered.length)throw new Error('WBS H1 company scopes are not unique');
  if(companyCode!==null){
    const exact=ordered.filter(row=>row.company_code===companyCode);
    if(exact.length!==1)throw new Error(`WBS company ${companyCode} was not provisioned exactly once`);
    return Object.freeze(exact);
  }
  return Object.freeze(ordered.filter(row=>startAfter===null||row.company_code>startAfter).slice(0,limit));
}

export async function runWbsH1CompanyBatch({companies,months=MONTHS,service,onProgress=()=>{}}={}){
  if(!Array.isArray(companies)||!companies.length||!Array.isArray(months)||!months.length||months.some(month=>!MONTHS.includes(month))||typeof service?.importRange!=='function'||typeof onProgress!=='function')throw new Error('WBS H1 company runner configuration is invalid');
  const summary={status:'WBS_H1_COMPANY_BATCH_COMPLETE',company_count:companies.length,month_attempt_count:0,complete_count:0,empty_count:0,failed_count:0,partial_retry_count:0,companies:[]};
  for(const company of companies){
    const companyResult={company_code:company.company_code,entity_id:company.entity_id,complete_months:[],empty_months:[],failed_months:[]};
    for(const periodCode of months){
      summary.month_attempt_count++;
      const input={tenantId:company.tenant_id,entityId:company.entity_id,companyCode:company.company_code,dateFrom:`${periodCode}-01`,dateTo:monthEnd(periodCode),pageSize:10,maxPages:1000,idempotencyKey:idempotencyKey(company.company_code,periodCode)};
      try{
        let result;
        for(let attempt=0;attempt<100;attempt++){
          result=await service.importRange(input);
          if(result.status==='WBS_TEST_MONTH_IMPORT_COMPLETE')break;
          if(result.status!=='WBS_TEST_MONTH_IMPORT_PARTIAL')throw new Error('WBS month import returned an unknown status');
          summary.partial_retry_count++;
        }
        if(result?.status!=='WBS_TEST_MONTH_IMPORT_COMPLETE')throw new Error('WBS month import did not complete within the bounded checkpoint retries');
        summary.complete_count++;companyResult.complete_months.push(periodCode);
        onProgress(Object.freeze({status:'WBS_H1_COMPANY_MONTH_COMPLETE',company_code:company.company_code,entity_id:company.entity_id,period_code:periodCode,payables:result.payables.record_count,bank_rows:result.bank.record_count}));
      }catch(error){
        if(error?.code==='WBS_TEST_IMPORT_EMPTY'){
          summary.empty_count++;companyResult.empty_months.push(periodCode);
          onProgress(Object.freeze({status:'WBS_H1_COMPANY_MONTH_EMPTY',company_code:company.company_code,entity_id:company.entity_id,period_code:periodCode}));
          continue;
        }
        summary.failed_count++;companyResult.failed_months.push(Object.freeze({period_code:periodCode,code:typeof error?.code==='string'?error.code:'UNEXPECTED',message:typeof error?.message==='string'?error.message:'Unknown import failure'}));
        onProgress(Object.freeze({status:'WBS_H1_COMPANY_MONTH_FAILED',company_code:company.company_code,entity_id:company.entity_id,period_code:periodCode,code:typeof error?.code==='string'?error.code:'UNEXPECTED'}));
      }
    }
    summary.companies.push(Object.freeze(companyResult));
  }
  if(summary.failed_count)summary.status='WBS_H1_COMPANY_BATCH_PARTIAL';
  return Object.freeze({...summary,companies:Object.freeze(summary.companies)});
}

async function main(){
  const required=['REFS_WBS_TEST_IMPORT_TENANT_ID','REFS_WBS_TEST_IMPORT_ENTITY_ID','WBS_CF_ACCESS_CLIENT_ID','WBS_CF_ACCESS_CLIENT_SECRET','WBS_REFS_AUTH',...ACTORS.map(role=>`REFS_WBS_TEST_IMPORT_${role.toUpperCase()}_ACTOR_ID`)];
  for(const key of required)if(!process.env[key])throw new Error(`${key} is required`);
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID,templateEntityId=process.env.REFS_WBS_TEST_IMPORT_ENTITY_ID;
  if(!UUID.test(tenantId)||!UUID.test(templateEntityId))throw new Error('WBS H1 configured tenant/entity scope is invalid');
  const actors=Object.freeze(Object.fromEntries(ACTORS.map(role=>[role,process.env[`REFS_WBS_TEST_IMPORT_${role.toUpperCase()}_ACTOR_ID`]])));
  if(new Set(Object.values(actors)).size!==ACTORS.length)throw new Error('WBS H1 import actors must be distinct');
  const selection={
    companyCode:process.env.REFS_WBS_H1_IMPORT_COMPANY?.trim().toUpperCase()||null,
    startAfter:process.env.REFS_WBS_H1_IMPORT_START_AFTER?.trim().toUpperCase()||null,
    limit:integer(process.env.REFS_WBS_H1_IMPORT_COMPANY_LIMIT||10,'REFS_WBS_H1_IMPORT_COMPANY_LIMIT',{min:1,max:50})
  };
  const requestedMonth=process.env.REFS_WBS_H1_IMPORT_MONTH?.trim()||null;
  if(requestedMonth!==null&&!MONTHS.includes(requestedMonth))throw new Error('REFS_WBS_H1_IMPORT_MONTH must be one 2026 H1 period');
  const config=runtimeConfig(process.env);
  const [runtimePool,issuerPool,migrationPool]=await Promise.all([
    createPool({databaseUrl:config.databaseUrl,applicationName:'refs-wbs-h1-all-company-runtime',max:4}),
    createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-wbs-h1-all-company-issuer',max:2}),
    createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-all-company-scope',max:1})
  ]);
  try{
    const rows=(await migrationPool.query(`SELECT tenant_id::text,entity_id::text,entity_code AS company_code
      FROM entity WHERE tenant_id=$1 AND active AND ((source_system='WBS' AND source_entity_id=entity_code) OR (entity_id=$2 AND entity_code='WBPA' AND source_system='REFS_STAGE1' AND source_entity_id='REFS_US_001'))
      ORDER BY entity_code`,[tenantId,templateEntityId])).rows;
    const companies=selectWbsH1CompanyBatch(rows,selection);
    const kernelFor=actorId=>{const principal={trusted:true,tenantId,actorId},issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>principal});return new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>issuer.issue({tenantId})});};
    const importerKernel=kernelFor(actors.importer);
    const client=createWbsLivePilotClient({credentials:{'CF-Access-Client-Id':process.env.WBS_CF_ACCESS_CLIENT_ID,'CF-Access-Client-Secret':process.env.WBS_CF_ACCESS_CLIENT_SECRET,'X-REFS-Auth':process.env.WBS_REFS_AUTH}});
    const pilotService=createWbsLivePilotReadService({client,authorize:scope=>importerKernel.assertWbsTestImport(scope),onRawPage:page=>stageWbsH1PayableMappingRawPageForTestImport({pool:migrationPool,...page,onDrift:row=>process.stdout.write(`${JSON.stringify(row)}\n`)})});
    const service=createWbsTestImportService({
      scope:{tenantId,entityId:templateEntityId,companyCode:'WBPA',actors},
      resolveScope:selectionInput=>importerKernel.resolveWbsTestImportScope(selectionInput),
      authorizeBank:scope=>importerKernel.assertWbsTestImport(scope),pilotService,kernelForActor:kernelFor
    });
    const summary=await runWbsH1CompanyBatch({companies,months:requestedMonth?[requestedMonth]:MONTHS,service,onProgress:row=>process.stdout.write(`${JSON.stringify(row)}\n`)});
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if(summary.failed_count)process.exitCode=1;
  }finally{await Promise.allSettled([runtimePool.end(),issuerPool.end(),migrationPool.end()]);}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_COMPANY_BATCH_FAILED',code:error?.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
