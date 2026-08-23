import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),runId=randomUUID();
const hash=`sha256:${'a'.repeat(64)}`;
const manifest={schema_version:'WBS_H1_2026_LOCAL_SNAPSHOT_V1',domain:'accounting_info',company_code:'WBPA',period:'2026-H1',date_from:'2026-01-01',date_to:'2026-06-30',generated_at:'2026-08-23T00:00:00.000Z',file_name:'accounting_info__WBPA__2026-H1.ndjson',rows:2,bytes:42,sha256:'b'.repeat(64)};
const body={runId,companyCode:'WBPA',currency:'USD',sourceVersion:hash,snapshotTokenHash:hash,providerContentHash:hash,sourceManifest:manifest,capturedAt:manifest.generated_at,expectedRowCount:2,includedH1RowCount:2,excludedRowCount:0,expectedDebitAmount:'1.0000',expectedCreditAmount:'1.0000',populationHash:hash};

test('WBS H1 accounting control HTTP ingestion is authenticated, resumable, bounded, and no-store',async()=>{
  const calls=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-importer'}),kernelFactory:async()=>({
    createWbsH1AccountingControlPopulationRun:async args=>(calls.push(['create',args]),{run_id:args.runId,idempotent:false}),
    appendWbsH1AccountingControlPopulationLines:async args=>(calls.push(['append',args]),{run_id:args.runId,accepted_row_count:args.lines.length}),
    finalizeWbsH1AccountingControlPopulationRun:async args=>(calls.push(['finalize',args]),{run_id:args.runId,receipt_hash:hash,idempotent:false})
  })});
  const root=`/api/v1/entities/${entityId}/wbs/h1-accounting-control-runs`;
  let response=await api({method:'POST',url:root,body,headers:{'Idempotency-Key':'wbs-h1-control-create-001'}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.equal(calls[0][0],'create');assert.equal(calls[0][1].tenantId,tenantId);assert.equal(calls[0][1].entityId,entityId);assert.match(calls[0][1].population.source_manifest_hash,/^sha256:[0-9a-f]{64}$/);
  response=await api({method:'POST',url:`${root}/${runId}/lines`,body:{lines:[{line_hash:hash}]},headers:{}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls[1],['append',{tenantId,entityId,runId,lines:[{line_hash:hash}]}]);
  response=await api({method:'POST',url:`${root}/${runId}/finalize`,body:{},headers:{}});
  assert.equal(response.status,201);assert.equal(response.body.data.receipt_hash,hash);assert.deepEqual(calls[2],['finalize',{tenantId,entityId,runId}]);
  assert.equal((await api({method:'POST',url:root,body:{...body,expectedRowCount:3},headers:{'Idempotency-Key':'wbs-h1-control-create-002'}})).status,400);
  assert.equal((await api({method:'POST',url:`${root}/${runId}/lines`,body:{lines:Array.from({length:1001},()=>({}))},headers:{}})).status,400);
  assert.equal((await api({method:'POST',url:`${root}/${runId}/finalize?x=1`,body:{},headers:{}})).status,400);
});
