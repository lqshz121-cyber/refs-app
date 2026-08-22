#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {provisionDirectWbsCompanyScopes} from './provision-wbs-h1-companies.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const readStdin=async()=>{const chunks=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString('utf8');};

async function main(){
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID,templateEntityId=process.env.REFS_WBS_TEST_IMPORT_ENTITY_ID;
  if(!process.env.MIGRATION_DATABASE_URL||!UUID.test(tenantId||'')||!UUID.test(templateEntityId||''))throw new Error('MIGRATION_DATABASE_URL and exact tenant/template entity IDs are required');
  const input=(await readStdin()).trim();if(!input)throw new Error('Direct WBS company JSON is required on stdin');
  let parsed;try{parsed=JSON.parse(input);}catch{parsed=input.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  const rows=Array.isArray(parsed)?parsed:Array.isArray(parsed?.rows)?parsed.rows:[parsed];
  const pool=await createPool({databaseUrl:process.env.MIGRATION_DATABASE_URL,applicationName:'refs-wbs-h1-direct-company-provisioner',max:1});
  try{process.stdout.write(`${JSON.stringify(await provisionDirectWbsCompanyScopes({pool,tenantId,templateEntityId,companies:rows}))}\n`);}
  finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_DIRECT_COMPANY_SCOPES_FAILED',message:error.message})}\n`);process.exitCode=1;});
