#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const ACCOUNT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
const strictDate=value=>{
  const raw=typeof value==='string'?value.trim():'';if(!/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(raw))return null;
  const date=raw.slice(0,10),[year,month,day]=date.split('-').map(Number),parsed=new Date(Date.UTC(year,month-1,day));return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day?date:null;
};
const field=(value,max,{empty=false}={})=>{const out=value==null?'':String(value).trim();if((!empty&&!out)||out.length>max||CONTROL.test(out))return null;return out;};

export function normalizeWbsH1AccountingSetting(row,{tenantId}={}){
  const settingId=Number(row?.id),companyCode=field(row?.company_code,64),settingType=field(row?.type,64),category=field(row?.category,64),businessType=Number(row?.business_type),detail=field(row?.detail,128,{empty:true}),projectCodes=field(row?.pj_code,4000,{empty:true}),journalCode=field(row?.journal_code,64,{empty:true}),accountName=field(row?.account,255,{empty:true}),supplementary=field(row?.supplementary,64,{empty:true}),effectiveFrom=strictDate(row?.start_date),effectiveTo=strictDate(row?.end_date);
  if(!UUID.test(tenantId||'')||!Number.isSafeInteger(settingId)||settingId<1||!COMPANY.test(companyCode||'')||settingType!=='Debit'||category!=='Payable'||businessType!==4||detail===null||projectCodes===null||journalCode===null||journalCode!==''&&!ACCOUNT.test(journalCode)||accountName===null||supplementary===null||!effectiveFrom||!effectiveTo||effectiveFrom>effectiveTo)throw new Error('WBS H1 accounting setting is outside the approved Payable mapping shape');
  const core={tenant_id:tenantId,company_code:companyCode,setting_id:settingId,setting_type:settingType,category,business_type:businessType,detail,project_codes:projectCodes,journal_code:journalCode,account_name:accountName,supplementary,effective_from:effectiveFrom,effective_to:effectiveTo};
  return Object.freeze({...core,setting_hash:canonicalRequestHash(core)});
}

async function main(){
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID;if(!UUID.test(tenantId||''))throw new Error('REFS_WBS_TEST_IMPORT_TENANT_ID is required');
  const input=(await readFile(0,'utf8')).trim();if(!input)throw new Error('WBS accounting settings JSON is required on stdin');
  let parsed;try{parsed=JSON.parse(input);}catch{parsed=input.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  const rows=(Array.isArray(parsed)?parsed:[parsed]).flatMap(value=>Array.isArray(value?.rows)?value.rows:[value]).map(row=>normalizeWbsH1AccountingSetting(row,{tenantId}));
  if(!rows.length||rows.length>1000||new Set(rows.map(row=>`${row.company_code}:${row.setting_id}:${row.setting_hash}`)).size!==rows.length)throw new Error('WBS accounting settings page must contain 1..1000 unique rows');
  const config=runtimeConfig(process.env),pool=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-accounting-setting-stage',max:1});
  try{
    const receipt=(await pool.query(`WITH input AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(tenant_id uuid,company_code text,setting_id bigint,setting_type text,category text,business_type integer,detail text,project_codes text,journal_code text,account_name text,supplementary text,effective_from date,effective_to date,setting_hash text)
      ), inserted AS (
        INSERT INTO wbs_h1_accounting_setting_stage SELECT input.*,clock_timestamp() FROM input ON CONFLICT DO NOTHING RETURNING 1
      ) SELECT (SELECT count(*)::integer FROM input) AS expected_count,(SELECT count(*)::integer FROM inserted) AS inserted_count,
        (SELECT count(*)::integer FROM input i JOIN wbs_h1_accounting_setting_stage s USING(tenant_id,company_code,setting_id,setting_hash)) AS exact_count`,[JSON.stringify(rows)])).rows[0];
    if(receipt.expected_count!==rows.length||receipt.exact_count!==rows.length)throw new Error('WBS accounting settings stage replay is incomplete');
    process.stdout.write(`${JSON.stringify({status:'WBS_H1_ACCOUNTING_SETTINGS_STAGED',row_count:rows.length,inserted_count:receipt.inserted_count})}\n`);
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_ACCOUNTING_SETTINGS_STAGE_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
