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
const readStdin=async()=>{const chunks=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString('utf8');};
const safeOptional=value=>{if(value===null||value===undefined||String(value).trim()==='')return null;const normalized=String(value).trim();return normalized.length<=128&&!CONTROL.test(normalized)?normalized:null;};

export function normalizeDirectWbsH1PayableMappingRows(rows,{tenantId,entityId,companyCode,providerContentHash,capturedAt}={}){
  if(!Array.isArray(rows)||rows.length<1||rows.length>1000||!COMPANY.test(companyCode||''))throw new Error('Direct WBS Payable snapshot must contain 1..1000 rows for one company');
  const normalized=rows.map(row=>{
    const adapted={...row,ap_guid:row?.ap_guid??row?.uuid,pj_code:safeOptional(row?.pj_code??row?.project_code),cost_code:safeOptional(row?.cost_code),vendor_no:safeOptional(row?.vendor_no),posting_date:row?.posting_date??row?.incurred_date??row?.invoice_date};
    const rawDate=[adapted.posting_date,adapted.incurred_date,adapted.invoice_date].find(value=>typeof value==='string'&&value.trim()!=='')||'';
    const accountingDate=rawDate.trim().slice(0,10);
    const periodCode=accountingDate.slice(0,7);
    if(!MONTH.test(periodCode))throw new Error('Direct WBS Payable snapshot row is outside 2026 H1');
    return normalizeWbsH1PayableMappingRow(adapted,{tenantId,entityId,companyCode,periodCode,providerContentHash,capturedAt});
  });
  if(normalized.some(row=>row===null)||new Set(normalized.map(row=>row.source_record_hash)).size!==normalized.length)throw new Error('Direct WBS Payable snapshot scope or identity is not exact');
  return Object.freeze(normalized);
}

async function main(){
  const input=(await readStdin()).trim();if(!input)throw new Error('Direct WBS Payable snapshot JSON is required on stdin');
  const companyCode=process.env.REFS_WBS_H1_STAGE_COMPANY?.trim().toUpperCase()||'';
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID?.trim()||'';
  if(!COMPANY.test(companyCode)||!UUID.test(tenantId))throw new Error('REFS_WBS_H1_STAGE_COMPANY and REFS_WBS_TEST_IMPORT_TENANT_ID are required');
  const config=runtimeConfig(process.env),pool=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-direct-mapping-stage',max:1});
  try{
    const scopes=(await pool.query(`SELECT tenant_id::text,entity_id::text FROM entity
      WHERE tenant_id=$1 AND active AND source_system='WBS' AND source_entity_id=entity_code AND entity_code=$2 ORDER BY entity_id`,[tenantId,companyCode])).rows;
    if(scopes.length!==1)throw new Error('Direct WBS company scope is not provisioned exactly once in REFS');
    const parsed=JSON.parse(input),providerContentHash=`sha256:${createHash('sha256').update(input,'utf8').digest('hex')}`,capturedAt=new Date().toISOString();
    const omittedInvalidDimensionCount=parsed.reduce((count,row)=>count+['pj_code','project_code','cost_code','vendor_no'].filter(key=>row?.[key]!=null&&String(row[key]).trim()!==''&&safeOptional(row[key])===null).length,0);
    const rows=normalizeDirectWbsH1PayableMappingRows(parsed,{tenantId:scopes[0].tenant_id,entityId:scopes[0].entity_id,companyCode,providerContentHash,capturedAt});
    await retainWbsH1PayableMappingSourceRows(pool,rows);
    process.stdout.write(`${JSON.stringify({status:'WBS_H1_DIRECT_PAYABLE_MAPPING_SOURCE_STAGED',company_code:companyCode,row_count:rows.length,omitted_invalid_dimension_count:omittedInvalidDimensionCount})}\n`);
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_DIRECT_PAYABLE_MAPPING_SOURCE_STAGE_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
