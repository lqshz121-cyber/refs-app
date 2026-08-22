#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';
import {buildWbsLivePilotObservation} from '../runtime/wbs-live-pilot-read-service.mjs';
import {createWbsTestImportService} from '../runtime/wbs-test-import-service.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const PROVIDER_ID=/^[A-Za-z0-9][A-Za-z0-9._~:-]{0,255}$/;
const MONTH=/^2026-0[1-6]$/;
const ACTORS=Object.freeze(['importer','maker','submitter','reviewer','approver','poster']);
const readStdin=async()=>{const chunks=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString('utf8');};
const strictDate=value=>{
  const raw=typeof value==='string'?value.trim().slice(0,10):'';if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;
  const [year,month,day]=raw.split('-').map(Number),parsed=new Date(Date.UTC(year,month-1,day));
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day?raw:null;
};
const money4=value=>{
  const raw=typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value.trim():'';
  if(!/^-?(?:0|[1-9]\d{0,15})(?:\.\d+)?$/.test(raw))return null;
  const [whole,fraction='']=raw.split('.');if(fraction.length>4&&!/^0+$/.test(fraction.slice(4)))return null;
  const out=`${whole}.${fraction.slice(0,4).padEnd(4,'0')}`;return out==='0.0000'||out==='-0.0000'?null:out;
};
const monthEnd=periodCode=>new Date(Date.UTC(2026,Number(periodCode.slice(5,7)),0)).toISOString().slice(0,10);
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');

export function normalizeDirectWbsTestPayables(rows,{companyCode}={}){
  if(!Array.isArray(rows)||rows.length<1||rows.length>1000||!COMPANY.test(companyCode||''))throw new Error('Direct controlled WBS Payable import requires 1..1000 rows for one company');
  const normalized=rows.map(row=>{
    const sourceId=String(row?.ap_guid??row?.uuid??'').trim(),rowCompany=String(row?.company_code??'').trim().toUpperCase(),accountingDate=strictDate(row?.posting_date??row?.incurred_date??row?.invoice_date),amount=money4(row?.amount);
    if(!PROVIDER_ID.test(sourceId)||rowCompany!==companyCode||!accountingDate||!MONTH.test(accountingDate.slice(0,7))||!amount)throw new Error('Direct controlled WBS Payable row is outside the exact H1 company contract');
    return Object.freeze({ap_guid:sourceId,company_code:companyCode,posting_date:accountingDate,amount,pay_status:'DIRECT_CONNECTED_TEST'});
  }).sort((left,right)=>left.posting_date.localeCompare(right.posting_date)||left.ap_guid.localeCompare(right.ap_guid));
  if(new Set(normalized.map(row=>row.ap_guid)).size!==normalized.length)throw new Error('Direct controlled WBS Payable source identity is duplicated');
  return Object.freeze(normalized);
}

export async function runDirectWbsTestPayableImport({rows,companyCode,entityId,tenantId,periods,service,capturedAt='2026-07-01T00:00:00.000Z'}={}){
  if(!UUID.test(entityId||'')||!UUID.test(tenantId||'')||!Array.isArray(periods)||periods.length!==6||typeof service?.importPayables!=='function')throw new Error('Direct controlled WBS Payable import dependencies are incomplete');
  const normalized=normalizeDirectWbsTestPayables(rows,{companyCode}),periodByCode=new Map(periods.map(row=>[row.period_code,row]));
  if(periodByCode.size!==6||periods.some(row=>!MONTH.test(row?.period_code||'')||!UUID.test(row?.period_id||'')||row.starts_on!==`${row.period_code}-01`||row.ends_on!==monthEnd(row.period_code)))throw new Error('Direct controlled WBS Payable H1 periods are incomplete');
  const receipt={status:'WBS_H1_DIRECT_PAYABLE_IMPORT_COMPLETE',company_code:companyCode,row_count:normalized.length,imported_count:0,replayed_count:0,posted_count:0,test_only:true};
  for(const [periodCode,period] of periodByCode){
    const monthRows=normalized.filter(row=>row.posting_date.startsWith(periodCode));
    for(let offset=0;offset<monthRows.length;offset+=10){
      const chunk=monthRows.slice(offset,offset+10),contentSha=hash(canonicalRequestBody({company_code:companyCode,period_code:periodCode,rows:chunk}));
      const observed={tool_name:'list_payables',captured_at:capturedAt,content_sha256:contentSha,scope:{company_codes:[companyCode],date_range:[period.starts_on,period.ends_on]},rows:chunk};
      const observation=buildWbsLivePilotObservation({observed,entityId,tool:'list_payables',requestedScope:{company_code:companyCode,date_from:period.starts_on,date_to:period.ends_on}});
      const result=await service.importPayables({tenantId,entityId,periodId:period.period_id,companyCode,dateFrom:period.starts_on,dateTo:period.ends_on,limit:chunk.length,idempotencyKey:`direct-h1:${companyCode}:${periodCode}:${contentSha.slice(0,20)}`,observation});
      receipt.imported_count+=result.imported_count;receipt.replayed_count+=result.replayed_count;receipt.posted_count+=result.posted_count;
    }
  }
  if(receipt.posted_count!==receipt.imported_count+receipt.replayed_count||receipt.posted_count!==receipt.row_count)throw new Error('Direct controlled WBS Payable import receipt is incomplete');
  return Object.freeze(receipt);
}

async function main(){
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID,templateEntityId=process.env.REFS_WBS_TEST_IMPORT_ENTITY_ID,companyCode=process.env.REFS_WBS_H1_IMPORT_COMPANY?.trim().toUpperCase()||'';
  const actors=Object.freeze(Object.fromEntries(ACTORS.map(role=>[role,process.env[`REFS_WBS_TEST_IMPORT_${role.toUpperCase()}_ACTOR_ID`]])));
  if(!UUID.test(tenantId||'')||!UUID.test(templateEntityId||'')||!COMPANY.test(companyCode)||ACTORS.some(role=>typeof actors[role]!=='string'||!actors[role].trim()))throw new Error('Direct controlled WBS Payable import scope and actors are required');
  const input=(await readStdin()).trim();if(!input)throw new Error('Direct WBS Payable JSON is required on stdin');
  const rows=JSON.parse(input),config=runtimeConfig(process.env);
  const [runtimePool,issuerPool,migrationPool]=await Promise.all([
    createPool({databaseUrl:config.databaseUrl,applicationName:'refs-wbs-h1-direct-payable-runtime',max:4}),
    createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-wbs-h1-direct-payable-issuer',max:2}),
    createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-direct-payable-scope',max:1})
  ]);
  try{
    const scopes=(await migrationPool.query(`SELECT e.entity_id::text,e.tenant_id::text,p.period_id::text,p.period_code,to_char(p.starts_on,'YYYY-MM-DD') starts_on,to_char(p.ends_on,'YYYY-MM-DD') ends_on
      FROM entity e JOIN accounting_period p ON p.tenant_id=e.tenant_id AND p.entity_id=e.entity_id AND p.ledger_code='PRIMARY'
      WHERE e.tenant_id=$1 AND e.entity_code=$2 AND e.source_system='WBS' AND e.source_entity_id=e.entity_code AND e.active AND p.status='OPEN' AND p.period_code BETWEEN '2026-01' AND '2026-06' ORDER BY p.period_code`,[tenantId,companyCode])).rows;
    if(scopes.length!==6||new Set(scopes.map(row=>row.entity_id)).size!==1)throw new Error('Direct WBS company must have exactly six OPEN H1 periods');
    const entityId=scopes[0].entity_id,principalFor=actorId=>({trusted:true,tenantId,actorId});
    const kernelForActor=actorId=>{const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>principalFor(actorId)});return new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>issuer.issue({tenantId})});};
    let currentObservation=null;
    const service=createWbsTestImportService({scope:{tenantId,entityId:templateEntityId,companyCode:'WBPA',actors},resolveScope:selection=>kernelForActor(actors.importer).resolveWbsTestImportScope(selection),kernelForActor,pilotService:{readObservation:async()=>currentObservation}});
    const adapter={importPayables:async args=>{currentObservation=args.observation;const inputArgs={...args};delete inputArgs.observation;return service.importPayables(inputArgs);}};
    process.stdout.write(`${JSON.stringify(await runDirectWbsTestPayableImport({rows,companyCode,entityId,tenantId,periods:scopes,service:adapter,capturedAt:new Date().toISOString()}))}\n`);
  }finally{await Promise.allSettled([runtimePool.end(),issuerPool.end(),migrationPool.end()]);}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_DIRECT_PAYABLE_IMPORT_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
