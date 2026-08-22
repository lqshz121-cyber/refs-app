#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createWbsLivePilotClient} from '../runtime/wbs-live-pilot-read-service.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^sha256:[0-9a-f]{64}$/;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
const MONTH=/^2026-0[1-6]$/;
const strictDate=value=>{
  const raw=typeof value==='string'?value.trim():'';
  if(!/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(raw))return null;
  const date=raw.slice(0,10),[year,month,day]=date.split('-').map(Number),parsed=new Date(Date.UTC(year,month-1,day));
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day?date:null;
};
const money4=value=>{
  const raw=typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value.trim():'';
  if(!/^-?(?:0|[1-9]\d{0,15})(?:\.\d+)?$/.test(raw))return null;
  const [whole,fraction='']=raw.split('.');
  if(fraction.length>4&&!/^0+$/.test(fraction.slice(4)))return null;
  return `${whole}.${fraction.slice(0,4).padEnd(4,'0')}`;
};
const optional=(value,max=128)=>{
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const normalized=String(value).trim();
  if(normalized.length>max||CONTROL.test(normalized))throw new Error('WBS H1 payable mapping dimension is invalid');
  return normalized;
};
const monthEnd=periodCode=>new Date(Date.UTC(2026,Number(periodCode.slice(5,7)),0)).toISOString().slice(0,10);
const MONTHS=Object.freeze(Array.from({length:6},(_,index)=>`2026-${String(index+1).padStart(2,'0')}`));
const integer=(value,name,{min,max})=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be between ${min} and ${max}`);return parsed;};
const sourceHash=wbsUuid=>`sha256:${createHash('sha256').update(`list_payables\u0000${wbsUuid}`,'utf8').digest('hex')}`;

export function normalizeWbsH1PayableMappingRow(row,{tenantId,entityId,companyCode,periodCode,providerContentHash,capturedAt}={}){
  const wbsUuid=optional(row?.ap_guid),accountingDate=strictDate(row?.posting_date)||strictDate(row?.incurred_date),amount=money4(row?.amount);
  if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!COMPANY.test(companyCode||'')||!MONTH.test(periodCode||'')||!wbsUuid||!PROVIDER_ID.test(wbsUuid)||!accountingDate||!amount||Number(amount)===0||!SHA.test(providerContentHash||'')||Number.isNaN(Date.parse(capturedAt||'')))throw new Error('WBS H1 payable mapping source row is invalid');
  if(row.company_code!==companyCode||accountingDate<`${periodCode}-01`||accountingDate>monthEnd(periodCode))return null;
  const facts={tenant_id:tenantId,entity_id:entityId,company_code:companyCode,period_code:periodCode,wbs_uuid:wbsUuid,source_record_hash:sourceHash(wbsUuid),accounting_date:accountingDate,amount,project_code:optional(row.pj_code),cost_code:optional(row.cost_code),vendor_no:optional(row.vendor_no)};
  return Object.freeze({...facts,provider_content_hash:providerContentHash,captured_at:new Date(capturedAt).toISOString(),source_fact_hash:canonicalRequestHash(facts)});
}

export async function retainWbsH1PayableMappingSourceRows(pool,rows){
  if(!rows.length)return;
  const result=await pool.query(`WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        tenant_id uuid,entity_id uuid,company_code text,period_code text,wbs_uuid text,
        source_record_hash text,accounting_date date,amount numeric(24,4),project_code text,
        cost_code text,vendor_no text,source_fact_hash text,provider_content_hash text,captured_at timestamptz)
    ), inserted AS (
      INSERT INTO wbs_h1_payable_mapping_source_stage(
        tenant_id,entity_id,company_code,period_code,wbs_uuid,source_record_hash,accounting_date,
        amount,project_code,cost_code,vendor_no,source_fact_hash,provider_content_hash,captured_at)
      SELECT tenant_id,entity_id,company_code,period_code,wbs_uuid,source_record_hash,accounting_date,
        amount,project_code,cost_code,vendor_no,source_fact_hash,provider_content_hash,captured_at FROM input
      ON CONFLICT DO NOTHING RETURNING 1
    )
    SELECT count(*)::integer AS expected_count,
      (count(*) FILTER(WHERE s.source_fact_hash=i.source_fact_hash)+(SELECT count(*) FROM inserted))::integer AS exact_count,
      (SELECT count(*)::integer FROM inserted) AS inserted_count
    FROM input i LEFT JOIN wbs_h1_payable_mapping_source_stage s
      ON s.tenant_id=i.tenant_id AND s.entity_id=i.entity_id AND s.source_record_hash=i.source_record_hash`,[JSON.stringify(rows)]);
  const receipt=result.rows[0];
  if(receipt.expected_count!==rows.length||receipt.exact_count!==rows.length)throw new Error('WBS H1 payable mapping source replay drifted from retained evidence');
}

export async function stageWbsH1PayableMappingRawPage({pool,tenantId,entityId,tool,companyCode,observed}={}){
  if(tool!=='list_payables')return Object.freeze({staged_row_count:0});
  if(!observed||observed.tool_name!=='list_payables'||observed.scope?.company_codes?.length!==1||observed.scope.company_codes[0]!==companyCode||!Array.isArray(observed.rows)||!/^([0-9a-f]{64})$/.test(observed.content_sha256||''))throw new Error('WBS payable raw page is outside the mapping stage contract');
  const providerContentHash=`sha256:${observed.content_sha256}`,normalized=[];
  for(const row of observed.rows){const accountingDate=strictDate(row?.posting_date)||strictDate(row?.incurred_date),periodCode=accountingDate?.slice(0,7);if(!MONTH.test(periodCode||''))continue;const item=normalizeWbsH1PayableMappingRow(row,{tenantId,entityId,companyCode,periodCode,providerContentHash,capturedAt:observed.captured_at});if(item)normalized.push(item);}
  if(new Set(normalized.map(row=>row.source_record_hash)).size!==normalized.length)throw new Error('WBS payable raw page contains duplicate source identities');
  await retainWbsH1PayableMappingSourceRows(pool,normalized);return Object.freeze({staged_row_count:normalized.length});
}

export async function stageWbsH1PayableMappingCompanyMonth({client,pool,tenantId,entityId,companyCode,periodCode}){
  const baseArgs={limit:10,company_code:companyCode,incurred_date_from:`${periodCode}-01`,incurred_date_to:monthEnd(periodCode),posting_date_from:`${periodCode}-01`,posting_date_to:monthEnd(periodCode)};
  let cursor=null,snapshotToken=null,pageCount=0,rowCount=0,stagedCount=0;
  do{
    const args={...baseArgs};if(cursor!==null){args.cursor=cursor;args.snapshot_token=snapshotToken;}
    const page=await client.readView({toolName:'list_payables',args});
    if(page.tool_name!=='list_payables'||page.scope?.company_codes?.length!==1||page.scope.company_codes[0]!==companyCode)throw new Error('WBS payable page is outside the selected company');
    const pageToken=page.scope?.snapshot_token||null;
    if(page.cursor_next!==null&&!pageToken)throw new Error('WBS payable cursor page has no snapshot token');
    if(snapshotToken!==null&&pageToken!==snapshotToken)throw new Error('WBS payable cursor snapshot changed');
    snapshotToken=pageToken;pageCount++;rowCount+=page.rows.length;
    const providerContentHash=`sha256:${page.content_sha256}`,normalized=page.rows.map(row=>normalizeWbsH1PayableMappingRow(row,{tenantId,entityId,companyCode,periodCode,providerContentHash,capturedAt:page.captured_at})).filter(Boolean);
    if(new Set(normalized.map(row=>row.source_record_hash)).size!==normalized.length)throw new Error('WBS payable page contains duplicate source identities');
    await retainWbsH1PayableMappingSourceRows(pool,normalized);stagedCount+=normalized.length;cursor=page.cursor_next;
    if(pageCount>10000)throw new Error('WBS payable pagination exceeded the safe page bound');
  }while(cursor!==null);
  return Object.freeze({status:'WBS_H1_PAYABLE_MAPPING_SOURCE_STAGED',company_code:companyCode,period_code:periodCode,page_count:pageCount,provider_row_count:rowCount,staged_row_count:stagedCount});
}

async function main(){
  const required=['REFS_WBS_TEST_IMPORT_TENANT_ID','WBS_CF_ACCESS_CLIENT_ID','WBS_CF_ACCESS_CLIENT_SECRET','WBS_REFS_AUTH'];for(const key of required)if(!process.env[key])throw new Error(`${key} is required`);
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID,company=process.env.REFS_WBS_H1_STAGE_COMPANY?.trim().toUpperCase()||null,period=process.env.REFS_WBS_H1_STAGE_MONTH?.trim()||null,startAfter=process.env.REFS_WBS_H1_STAGE_START_AFTER?.trim().toUpperCase()||null,companyLimit=integer(process.env.REFS_WBS_H1_STAGE_COMPANY_LIMIT||10,'REFS_WBS_H1_STAGE_COMPANY_LIMIT',{min:1,max:50});
  if(!UUID.test(tenantId)||company!==null&&!COMPANY.test(company)||period!==null&&!MONTH.test(period)||startAfter!==null&&!COMPANY.test(startAfter))throw new Error('WBS H1 payable mapping stage selection is invalid');
  const config=runtimeConfig(process.env),pool=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-mapping-source-stage',max:1});
  try{
    const all=(await pool.query(`SELECT entity_id::text,entity_code AS company_code FROM entity WHERE tenant_id=$1 AND active AND source_system='WBS' AND source_entity_id=entity_code ORDER BY entity_code`,[tenantId])).rows;
    const scopes=company===null?all.filter(row=>startAfter===null||row.company_code>startAfter).slice(0,companyLimit):all.filter(row=>row.company_code===company);
    if(!scopes.length||company!==null&&scopes.length!==1)throw new Error('Selected WBS company scope is not provisioned exactly once in REFS');
    const client=createWbsLivePilotClient({credentials:{'CF-Access-Client-Id':process.env.WBS_CF_ACCESS_CLIENT_ID,'CF-Access-Client-Secret':process.env.WBS_CF_ACCESS_CLIENT_SECRET,'X-REFS-Auth':process.env.WBS_REFS_AUTH}});
    await client.initialize();await client.listTools();
    const summary={status:'WBS_H1_PAYABLE_MAPPING_SOURCE_BATCH_COMPLETE',company_count:scopes.length,month_attempt_count:0,staged_row_count:0,failed_count:0};
    for(const scope of scopes)for(const periodCode of period?[period]:MONTHS){summary.month_attempt_count++;try{const result=await stageWbsH1PayableMappingCompanyMonth({client,pool,tenantId,entityId:scope.entity_id,companyCode:scope.company_code,periodCode});summary.staged_row_count+=result.staged_row_count;process.stdout.write(`${JSON.stringify(result)}\n`);}catch(error){summary.failed_count++;process.stdout.write(`${JSON.stringify({status:'WBS_H1_PAYABLE_MAPPING_SOURCE_MONTH_FAILED',company_code:scope.company_code,period_code:periodCode,code:error.code||'UNEXPECTED',message:error.message})}\n`);}}
    if(summary.failed_count)summary.status='WBS_H1_PAYABLE_MAPPING_SOURCE_BATCH_PARTIAL';process.stdout.write(`${JSON.stringify(summary)}\n`);if(summary.failed_count)process.exitCode=1;
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_PAYABLE_MAPPING_SOURCE_STAGE_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
