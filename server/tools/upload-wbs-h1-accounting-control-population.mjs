#!/usr/bin/env node
// Uploads only normalized control evidence.  Raw NDJSON stays on the caller's
// machine and is streamed twice: first to bind the complete manifest/hash,
// then in bounded pages.  The bearer token is never printed.
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {validateWbsH1AccountingManifest,summarizeWbsH1AccountingStream,streamNormalizedWbsH1AccountingPages} from './retain-wbs-h1-accounting-control-population.mjs';

const MAX_PAGE_BYTES=7*1024*1024,EMPTY_PAGE_BYTES=Buffer.byteLength('{"lines":[]}','utf8'),MAX_ATTEMPTS=5;
const required=(env,name)=>{const value=env[name];if(!value)throw new Error(`${name} is required`);return value;};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const request=async({baseUrl,token,path,body,idempotencyKey=null})=>{
  const url=new URL(path,baseUrl.endsWith('/')?baseUrl:`${baseUrl}/`),encoded=JSON.stringify(body);
  let lastError;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),90000);
    try{
      const response=await fetch(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(idempotencyKey?{'idempotency-key':idempotencyKey}:{})},body:encoded});
      const result=await response.json().catch(()=>null);
      if(response.ok)return result?.data;
      if(![429,502,503,504].includes(response.status))throw new Error(`Remote ingestion failed: HTTP ${response.status} ${result?.code||'UNKNOWN'}`);
      lastError=new Error(`Remote ingestion temporarily unavailable: HTTP ${response.status} ${result?.code||'UNKNOWN'}`);
    }catch(error){if(error.name==='AbortError')lastError=new Error('Remote ingestion request timed out');else if(!/Remote ingestion failed/.test(error.message))lastError=error;else throw error;}
    finally{clearTimeout(timeout);}
    await sleep(250*(2**attempt));
  }
  throw lastError||new Error('Remote ingestion retry limit reached');
};
export async function uploadWbsH1AccountingControlPopulation({env=process.env,fetcher=request,report=()=>{}}={}){
  const manifestPath=required(env,'REFS_WBS_H1_ACCOUNTING_MANIFEST_PATH'),companyCode=required(env,'REFS_WBS_H1_ACCOUNTING_COMPANY_CODE'),tenantId=required(env,'REFS_WBS_H1_ACCOUNTING_TENANT_ID'),entityId=required(env,'REFS_WBS_H1_ACCOUNTING_ENTITY_ID'),baseUrl=required(env,'REFS_ACCOUNTING_API_BASE_URL'),token=required(env,'REFS_ACCOUNTING_API_BEARER_TOKEN'),currency=env.REFS_WBS_H1_ACCOUNTING_CURRENCY||'USD';
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),{sourceManifest,filePath}=validateWbsH1AccountingManifest(manifest,{manifestPath,companyCode});
  const sourceVersion=canonicalRequestHash({schema_version:'WBS_H1_ACCOUNTING_CONTROL_SOURCE_V1',manifest:sourceManifest}),streamArgs={filePath,sourceManifest,tenantId,entityId,currency,sourceVersion};let summary,runId,lastCompletedPage=0;
  try{
    summary=await summarizeWbsH1AccountingStream(streamArgs);runId=env.REFS_WBS_H1_ACCOUNTING_RUN_ID||randomUUID();const root=`/api/v1/entities/${entityId}/wbs/h1-accounting-control-runs`,idempotencyKey=env.REFS_WBS_H1_ACCOUNTING_IDEMPOTENCY_KEY||`wbs-h1-accounting:${sourceVersion.slice(7,55)}`;
    report({status:'WBS_H1_ACCOUNTING_CONTROL_UPLOAD_STARTED',run_id:runId,source_version:sourceVersion,expected_row_count:summary.expected_row_count});
    await fetcher({baseUrl,token,path:root,idempotencyKey,body:{runId,companyCode,currency,sourceVersion,snapshotTokenHash:summary.snapshot_token_hash,providerContentHash:summary.provider_content_hash,sourceManifest,capturedAt:summary.captured_at,expectedRowCount:summary.expected_row_count,includedH1RowCount:summary.included_h1_row_count,excludedRowCount:summary.excluded_row_count,expectedDebitAmount:summary.expected_debit_amount,expectedCreditAmount:summary.expected_credit_amount,populationHash:summary.population_hash}});
    let page=[],pageBytes=EMPTY_PAGE_BYTES;
    const flush=async()=>{if(!page.length)return;const nextPage=lastCompletedPage+1,accepted=await fetcher({baseUrl,token,path:`${root}/${runId}/lines`,idempotencyKey:`${idempotencyKey}:page:${nextPage}`,body:{lines:page.map(item=>item.line)}});lastCompletedPage=nextPage;report({status:'WBS_H1_ACCOUNTING_CONTROL_UPLOAD_PAGE_ACCEPTED',run_id:runId,page:lastCompletedPage,accepted_row_count:accepted?.accepted_row_count??page.length});page=[];pageBytes=EMPTY_PAGE_BYTES;};
    for await(const normalized of streamNormalizedWbsH1AccountingPages(streamArgs))for(const line of normalized){const encoded=JSON.stringify(line),lineBytes=Buffer.byteLength(encoded,'utf8'),nextBytes=pageBytes+(page.length?1:0)+lineBytes;if(page.length===1000||nextBytes>MAX_PAGE_BYTES){await flush();if(EMPTY_PAGE_BYTES+lineBytes>MAX_PAGE_BYTES)throw new Error('One normalized accounting row exceeds the 7 MiB page boundary');}page.push({line,bytes:lineBytes});pageBytes+=((page.length===1)?0:1)+lineBytes;}
    await flush();const receipt=await fetcher({baseUrl,token,path:`${root}/${runId}/finalize`,idempotencyKey:`${idempotencyKey}:finalize`,body:{}});report({status:'WBS_H1_ACCOUNTING_CONTROL_UPLOAD_COMPLETE',run_id:runId,page_count:lastCompletedPage,receipt_hash:receipt?.receipt_hash||null});return {runId,pageCount:lastCompletedPage,receipt};
  }catch(error){Object.assign(error,{runId,lastCompletedPage,sourceVersion,expectedRowCount:summary?.expected_row_count??null});throw error;}
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)uploadWbsH1AccountingControlPopulation({report:event=>process.stdout.write(`${JSON.stringify(event)}\n`)}).then(result=>process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_ACCOUNTING_CONTROL_UPLOAD_FAILED',run_id:error.runId||null,last_completed_page:error.lastCompletedPage||0,source_version:error.sourceVersion||null,expected_row_count:error.expectedRowCount,message:error.message})}\n`);process.exitCode=1;});
