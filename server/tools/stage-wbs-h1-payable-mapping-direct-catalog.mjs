#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {normalizeWbsH1PayableMappingRow,retainWbsH1PayableMappingSourceRows} from './stage-wbs-h1-payable-mapping-source.mjs';

const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const MONTH=/^2026-0[1-6]$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL=/[\u0000-\u001f\u007f]/;
const MAX_ROWS=5000;
const readStdin=async()=>{const chunks=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString('utf8');};
const safeOptional=value=>{if(value===null||value===undefined||String(value).trim()==='')return null;const normalized=String(value).trim();return normalized.length<=128&&!CONTROL.test(normalized)?normalized:null;};

export function normalizeDirectWbsH1CatalogRows(rows,{tenantId,entityByCompany,providerContentHash,capturedAt}={}){
  if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_ROWS||!UUID.test(tenantId||'')||!(entityByCompany instanceof Map))throw new Error('Direct WBS catalog must contain 1..5000 rows under one tenant');
  const normalized=rows.map(row=>{
    const companyCode=String(row?.company_code||'').trim().toUpperCase(),entityId=entityByCompany.get(companyCode);
    if(!COMPANY.test(companyCode)||!UUID.test(entityId||''))throw new Error('Direct WBS catalog company is not provisioned exactly once in REFS');
    const adapted={...row,company_code:companyCode,ap_guid:row?.ap_guid??row?.uuid,pj_code:safeOptional(row?.pj_code??row?.project_code),cost_code:safeOptional(row?.cost_code),vendor_no:safeOptional(row?.vendor_no),posting_date:row?.posting_date??row?.incurred_date??row?.invoice_date};
    const rawDate=[adapted.posting_date,adapted.incurred_date,adapted.invoice_date].find(value=>typeof value==='string'&&value.trim()!=='')||'',accountingDate=rawDate.trim().slice(0,10),periodCode=accountingDate.slice(0,7);
    if(!MONTH.test(periodCode))throw new Error('Direct WBS catalog row is outside 2026 H1');
    return normalizeWbsH1PayableMappingRow(adapted,{tenantId,entityId,companyCode,periodCode,providerContentHash,capturedAt});
  });
  if(normalized.some(row=>row===null)||new Set(normalized.map(row=>`${row.company_code}:${row.source_record_hash}`)).size!==normalized.length)throw new Error('Direct WBS catalog scope or identity is not exact');
  return Object.freeze(normalized);
}

async function main(){
  const input=(await readStdin()).trim();if(!input)throw new Error('Direct WBS catalog JSON is required on stdin');
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID?.trim()||'';if(!UUID.test(tenantId))throw new Error('REFS_WBS_TEST_IMPORT_TENANT_ID is required');
  const parsed=JSON.parse(input);if(!Array.isArray(parsed)||parsed.length<1||parsed.length>MAX_ROWS)throw new Error('Direct WBS catalog must contain 1..5000 rows');
  const companyCodes=[...new Set(parsed.map(row=>String(row?.company_code||'').trim().toUpperCase()))].sort();if(companyCodes.some(code=>!COMPANY.test(code)))throw new Error('Direct WBS catalog company code is invalid');
  const config=runtimeConfig(process.env),pool=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-direct-catalog-stage',max:1});
  try{
    const scopes=(await pool.query(`SELECT entity_code AS company_code,entity_id::text FROM entity WHERE tenant_id=$1 AND active AND source_system='WBS' AND source_entity_id=entity_code AND entity_code=ANY($2::text[]) ORDER BY entity_code`,[tenantId,companyCodes])).rows;
    const entityByCompany=new Map(scopes.map(row=>[row.company_code,row.entity_id]));if(entityByCompany.size!==companyCodes.length)throw new Error('Every direct WBS catalog company must be provisioned exactly once in REFS');
    const providerContentHash=`sha256:${createHash('sha256').update(input,'utf8').digest('hex')}`,capturedAt=new Date().toISOString(),rows=normalizeDirectWbsH1CatalogRows(parsed,{tenantId,entityByCompany,providerContentHash,capturedAt});
    const grouped=new Map();for(const row of rows){const group=grouped.get(row.company_code)||[];group.push(row);grouped.set(row.company_code,group);}
    for(const group of grouped.values())await retainWbsH1PayableMappingSourceRows(pool,group);
    process.stdout.write(`${JSON.stringify({status:'WBS_H1_DIRECT_PAYABLE_CATALOG_STAGED',company_count:grouped.size,row_count:rows.length})}\n`);
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_DIRECT_PAYABLE_CATALOG_STAGE_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
