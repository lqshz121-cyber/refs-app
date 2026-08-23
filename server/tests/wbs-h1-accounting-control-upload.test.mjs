import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {uploadWbsH1AccountingControlPopulation} from '../tools/upload-wbs-h1-accounting-control-population.mjs';

const row=(id,debtor,lender)=>({id,com_code:'WBPA',posting_date:'2026-01-15',account:id===1?'610000':'291001',cb_id:'17661586404270',debtor,lender,payee:'V-1',pj_code:'P-1',cost_code:'C-1',unit:'U-1',come_from:'PAYABLE',source:'WBS',review:'Y',closed:'N'});
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'wbs-h1-upload-')),rows=`${JSON.stringify(row(1,'100.0000','0'))}\n${JSON.stringify(row(2,'0','100.0000'))}\n`,dataPath=join(dir,'accounting_info__WBPA__2026-H1.ndjson'),sha256=createHash('sha256').update(rows).digest('hex'),manifestPath=join(dir,'manifest.json');await writeFile(dataPath,rows);await writeFile(manifestPath,JSON.stringify({schema_version:'WBS_H1_2026_LOCAL_SNAPSHOT_V1',date_from:'2026-01-01',date_to:'2026-06-30',generated_at:'2026-08-23T12:00:00.000Z',files:[{domain:'accounting_info',company_code:'WBPA',period:'2026-H1',path:dataPath,rows:2,bytes:Buffer.byteLength(rows),sha256}]}));return {dir,manifestPath};}
const envFor=manifestPath=>({REFS_WBS_H1_ACCOUNTING_MANIFEST_PATH:manifestPath,REFS_WBS_H1_ACCOUNTING_COMPANY_CODE:'WBPA',REFS_WBS_H1_ACCOUNTING_TENANT_ID:randomUUID(),REFS_WBS_H1_ACCOUNTING_ENTITY_ID:randomUUID(),REFS_ACCOUNTING_API_BASE_URL:'https://refs.example',REFS_ACCOUNTING_API_BEARER_TOKEN:'test-token-not-reported'});

test('uploader emits resumable safe progress and retains no raw rows or bearer in events',async()=>{
  const {dir,manifestPath}=await fixture(),events=[],requests=[];try{
    const result=await uploadWbsH1AccountingControlPopulation({env:envFor(manifestPath),report:event=>events.push(event),fetcher:async input=>{requests.push({path:input.path,bodyKeys:Object.keys(input.body)});return input.path.endsWith('/lines')?{accepted_row_count:2}:input.path.endsWith('/finalize')?{receipt_hash:`sha256:${'c'.repeat(64)}`}:{run_id:input.body.runId,idempotent:false};}});
    assert.equal(requests.length,3);assert.equal(events[0].status,'WBS_H1_ACCOUNTING_CONTROL_UPLOAD_STARTED');assert.equal(events[1].accepted_row_count,2);assert.equal(events[2].status,'WBS_H1_ACCOUNTING_CONTROL_UPLOAD_COMPLETE');assert.equal(events.some(event=>JSON.stringify(event).includes('test-token-not-reported')),false);assert.equal(result.pageCount,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('uploader exposes run and last completed page on a recoverable page failure',async()=>{
  const {dir,manifestPath}=await fixture();try{
    await assert.rejects(()=>uploadWbsH1AccountingControlPopulation({env:envFor(manifestPath),fetcher:async input=>{if(input.path.endsWith('/lines'))throw new Error('transient page failure');return {};}}),error=>UUID.test(error.runId||'')&&error.lastCompletedPage===0&&typeof error.sourceVersion==='string');
  }finally{await rm(dir,{recursive:true,force:true});}
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
