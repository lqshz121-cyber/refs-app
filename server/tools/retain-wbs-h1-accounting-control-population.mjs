#!/usr/bin/env node
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {canonicalRequestBody,canonicalRequestHash} from '../runtime/request-hash.mjs';
import {normalizeWbsH1AccountingControlRow} from '../runtime/wbs-h1-accounting-control-population.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,SHA64=/^[0-9a-f]{64}$/;
const COMPANY_CODE=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/,CURRENCY=/^[A-Z]{3}$/;
const strictUtcTimestamp=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return false;const parsed=new Date(value);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString()===value;};
export const providerRowsContentSha256=rows=>createHash('sha256').update(canonicalRequestBody(rows),'utf8').digest('hex');

export function validateCompleteWbsAccountingEnvelope(envelope){
  const companyCode=envelope?.scope?.company_codes?.[0],currency=envelope?.scope?.currency??'USD';
  if(!envelope||envelope.tool_name!=='list_journal_entries'||envelope.cursor_next!==null||!Array.isArray(envelope.rows)||envelope.rows.length<1||envelope.record_count!==envelope.rows.length||!SHA64.test(envelope.content_sha256||'')||providerRowsContentSha256(envelope.rows)!==envelope.content_sha256.toLowerCase()||typeof envelope.scope?.snapshot_token!=='string'||!envelope.scope.snapshot_token||!Array.isArray(envelope.scope.company_codes)||envelope.scope.company_codes.length!==1||!COMPANY_CODE.test(companyCode||'')||!CURRENCY.test(currency)||envelope.scope.date_range?.[0]!=='2026-01-01'||envelope.scope.date_range?.[1]!=='2026-06-30'||!strictUtcTimestamp(envelope.captured_at))throw new Error('A complete exhausted WBS H1 accounting snapshot-token population with an exact provider rows hash is required');return envelope;
}

export function validateWbsH1AccountingManifest(manifest,{manifestPath,companyCode}){
  if(!manifest||manifest.schema_version!=='WBS_H1_2026_LOCAL_SNAPSHOT_V1'||manifest.date_from!=='2026-01-01'||manifest.date_to!=='2026-06-30'||!strictUtcTimestamp(manifest.generated_at)||!COMPANY_CODE.test(companyCode||'')||!Array.isArray(manifest.files))throw new Error('The WBS H1 manifest scope is invalid');
  const matches=manifest.files.filter(file=>file?.domain==='accounting_info'&&file.company_code===companyCode&&file.period==='2026-H1');
  if(matches.length!==1)throw new Error('The WBS H1 accounting_info manifest entry is missing or ambiguous');
  const entry=matches[0],fileName=`accounting_info__${companyCode}__2026-H1.ndjson`;
  if(basename(String(entry.path||'').replace(/\\/g,'/'))!==fileName||!Number.isSafeInteger(entry.rows)||entry.rows<1||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||!SHA64.test(entry.sha256||''))throw new Error('The WBS H1 accounting_info manifest entry is invalid');
  const sourceManifest=Object.freeze({schema_version:manifest.schema_version,domain:'accounting_info',company_code:companyCode,period:'2026-H1',date_from:manifest.date_from,date_to:manifest.date_to,generated_at:manifest.generated_at,file_name:fileName,rows:entry.rows,bytes:entry.bytes,sha256:entry.sha256.toLowerCase()});
  return Object.freeze({sourceManifest,filePath:join(dirname(manifestPath),fileName)});
}

const moneyUnits=value=>BigInt(String(value).replace('.',''));
const unitsMoney=value=>`${value<0n?'-':''}${String(value<0n?-value:value).padStart(5,'0').slice(0,-4)}.${String(value<0n?-value:value).padStart(5,'0').slice(-4)}`;

export async function* streamNormalizedWbsH1AccountingPages({filePath,sourceManifest,tenantId,entityId,currency,sourceVersion,pageSize=1000}){
  if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!CURRENCY.test(currency||'')||!/^sha256:[0-9a-f]{64}$/.test(sourceVersion||'')||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1000)throw new Error('The streamed WBS normalization scope is invalid');
  const input=createReadStream(filePath),rawHash=createHash('sha256');let rawBytes=0,rowCount=0,lastId=0,page=[];
  input.on('data',chunk=>{rawBytes+=chunk.length;rawHash.update(chunk);});
  const lines=createInterface({input,crlfDelay:Infinity});
  try{for await(const rawLine of lines){if(rawLine.trim()==='')throw new Error('Blank NDJSON rows are not allowed');let row;try{row=JSON.parse(rawLine);}catch{throw new Error(`Invalid WBS NDJSON at row ${rowCount+1}`);}const id=Number(row?.id);if(!Number.isSafeInteger(id)||id<=lastId)throw new Error(`WBS accounting_info IDs must be strictly ascending at row ${rowCount+1}`);lastId=id;rowCount++;page.push(normalizeWbsH1AccountingControlRow(row,{tenantId,entityId,companyCode:sourceManifest.company_code,currency,sourceVersion,rowOrdinal:rowCount}));if(page.length===pageSize){yield page;page=[];}}if(page.length)yield page;}finally{lines.close();}
  const digest=rawHash.digest('hex');if(rowCount!==sourceManifest.rows||rawBytes!==sourceManifest.bytes||digest!==sourceManifest.sha256)throw new Error(`WBS accounting_info manifest drift: rows=${rowCount}, bytes=${rawBytes}, sha256=${digest}`);
}

export async function summarizeWbsH1AccountingStream(args){
  let count=0,included=0,debit=0n,credit=0n;const populationHash=createHash('sha256'),groups=new Map(),gapCounts=new Map();
  for await(const page of streamNormalizedWbsH1AccountingPages(args))for(const line of page){count++;populationHash.update(`${line.line_hash}\n`,'utf8');for(const gap of line.gap_codes)gapCounts.set(gap,(gapCounts.get(gap)??0)+1);if(line.excluded_from_h1)continue;included++;debit+=moneyUnits(line.debit_amount);credit+=moneyUnits(line.credit_amount);const key=`${line.period_code}\0${line.currency}\0${line.come_from}`,group=groups.get(key)??{debit:0n,credit:0n,count:0,hash:createHash('sha256')};group.count++;group.debit+=moneyUnits(line.debit_amount);group.credit+=moneyUnits(line.credit_amount);group.hash.update(`${line.line_hash}\n`,'utf8');groups.set(key,group);}
  if(debit!==credit||[...groups.values()].some(group=>group.debit!==group.credit))throw new Error('The complete WBS H1 accounting population is not balanced by period/currency/module');
  return Object.freeze({schema_version:'WBS_H1_ACCOUNTING_CONTROL_POPULATION_V1',tenant_id:args.tenantId,entity_id:args.entityId,company_code:args.sourceManifest.company_code,currency:args.currency,source_version:args.sourceVersion,snapshot_token_hash:canonicalRequestHash(args.sourceManifest),provider_content_hash:`sha256:${args.sourceManifest.sha256}`,source_manifest:args.sourceManifest,source_manifest_hash:canonicalRequestHash(args.sourceManifest),captured_at:args.sourceManifest.generated_at,expected_row_count:count,included_h1_row_count:included,excluded_row_count:count-included,expected_debit_amount:unitsMoney(debit),expected_credit_amount:unitsMoney(credit),population_hash:`sha256:${populationHash.digest('hex')}`,module_receipt_count:groups.size,gap_counts:Object.freeze(Object.fromEntries([...gapCounts].sort())),manifest_file_hash_match:true,accounting_authority:'CONTROL_EVIDENCE_ONLY',can_create_draft:false,can_review:false,can_approve:false,can_post:false});
}

async function main(){
  const manifestPath=process.env.REFS_WBS_H1_ACCOUNTING_MANIFEST_PATH,companyCode=process.env.REFS_WBS_H1_ACCOUNTING_COMPANY_CODE,tenantId=process.env.REFS_WBS_H1_ACCOUNTING_TENANT_ID,entityId=process.env.REFS_WBS_H1_ACCOUNTING_ENTITY_ID,currency=process.env.REFS_WBS_H1_ACCOUNTING_CURRENCY||'USD',dryRun=process.env.REFS_WBS_H1_ACCOUNTING_DRY_RUN==='true';
  if(!manifestPath||!COMPANY_CODE.test(companyCode||'')||!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!CURRENCY.test(currency))throw new Error('Manifest path, company, tenant, entity, and ISO currency are required');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),{sourceManifest,filePath}=validateWbsH1AccountingManifest(manifest,{manifestPath,companyCode}),sourceVersion=canonicalRequestHash({schema_version:'WBS_H1_ACCOUNTING_CONTROL_SOURCE_V1',manifest:sourceManifest}),streamArgs={filePath,sourceManifest,tenantId,entityId,currency,sourceVersion},population=await summarizeWbsH1AccountingStream(streamArgs);
  if(dryRun){process.stdout.write(`${JSON.stringify(population)}\n`);return;}
  const actorId=process.env.REFS_WBS_H1_ACCOUNTING_ACTOR_ID;if(!actorId)throw new Error('A controlled import actor is required outside dry-run mode');
  const config=runtimeConfig(process.env),runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-wbs-h1-accounting-control',max:1}),issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-wbs-h1-accounting-control-issuer',max:1});
  try{const kernel=new PostgresAccountingKernel(runtime,{sessionProvider:()=>new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,tenantId,actorId})}).issue({tenantId})});const runId=process.env.REFS_WBS_H1_ACCOUNTING_RUN_ID||randomUUID(),idempotencyKey=process.env.REFS_WBS_H1_ACCOUNTING_IDEMPOTENCY_KEY||`wbs-h1-accounting:${sourceVersion.slice(7,55)}`;const receipt=await kernel.retainWbsH1AccountingControlPopulation({tenantId,entityId,runId,idempotencyKey,population,linePageFactory:()=>streamNormalizedWbsH1AccountingPages(streamArgs)});process.stdout.write(`${JSON.stringify(receipt)}\n`);}finally{await Promise.allSettled([runtime.end(),issuer.end()]);}
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_ACCOUNTING_CONTROL_RETAIN_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
