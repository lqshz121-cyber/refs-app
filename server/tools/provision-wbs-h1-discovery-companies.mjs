#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createPool} from '../runtime/db.mjs';
import {provisionDirectWbsCompanyScopes} from './provision-wbs-h1-companies.mjs';

const EXPECTED_SHA256='f5481693200718ffd9128ca3e9e18c1775d77f329ac7cd931d86dbe076a76373';
const EXPECTED_COMPANY_COUNT=192;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const extractJsonObject=(source,marker)=>{
  const markerIndex=source.indexOf(marker);
  if(markerIndex<0)throw new Error('The frozen WBS H1 discovery workbench does not contain its data payload');
  const start=markerIndex+marker.length;
  let depth=0,end=-1,inString=false,escaped=false;
  for(let index=start;index<source.length;index++){
    const value=source[index];
    if(inString){
      if(escaped)escaped=false;
      else if(value==='\\')escaped=true;
      else if(value==='"')inString=false;
      continue;
    }
    if(value==='"')inString=true;
    else if(value==='{')depth++;
    else if(value==='}'&&--depth===0){end=index+1;break;}
  }
  if(end<0)throw new Error('The frozen WBS H1 discovery data payload is incomplete');
  return JSON.parse(source.slice(start,end));
};

export function readFrozenWbsH1DiscoveryCatalog(source){
  if(typeof source!=='string'||createHash('sha256').update(source,'utf8').digest('hex')!==EXPECTED_SHA256)throw new Error('The frozen WBS H1 discovery workbench hash does not match the reviewed artifact');
  const data=extractJsonObject(source,'const DATA=');
  if(!Array.isArray(data?.companies)||data.companies.length!==EXPECTED_COMPANY_COUNT)throw new Error('The frozen WBS H1 discovery roster must contain exactly 192 companies');
  const rows=data.companies.map(row=>({company_code:row.company_code,company_name:`WBS ${row.company_code}`}));
  if(new Set(rows.map(row=>row.company_code)).size!==EXPECTED_COMPANY_COUNT)throw new Error('The frozen WBS H1 discovery roster repeats a company code');
  return Object.freeze(rows);
}

async function main(){
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID,templateEntityId=process.env.REFS_WBS_TEST_IMPORT_ENTITY_ID;
  if(!process.env.MIGRATION_DATABASE_URL||!UUID.test(tenantId||'')||!UUID.test(templateEntityId||''))throw new Error('MIGRATION_DATABASE_URL and exact tenant/template entity IDs are required');
  const artifactPath=resolve(fileURLToPath(new URL('../../outputs/wbs-h1-2026/qbo-company-workbench.html',import.meta.url)));
  const companies=readFrozenWbsH1DiscoveryCatalog(await readFile(artifactPath,'utf8'));
  const pool=await createPool({databaseUrl:process.env.MIGRATION_DATABASE_URL,applicationName:'refs-wbs-h1-discovery-company-provisioner',max:1});
  try{
    const result=await provisionDirectWbsCompanyScopes({pool,tenantId,templateEntityId,companies});
    process.stdout.write(`${JSON.stringify({...result,status:'WBS_H1_TEST_DISCOVERY_COMPANY_SCOPES_READY',catalog_authority:'TEST_DISCOVERY_ONLY',company_count:EXPECTED_COMPANY_COUNT,artifact_sha256:EXPECTED_SHA256})}\n`);
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_TEST_DISCOVERY_COMPANY_SCOPES_FAILED',message:error.message})}\n`);process.exitCode=1;});
