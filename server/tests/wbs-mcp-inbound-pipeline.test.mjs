import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsMcpInboundPipeline,WbsMcpInboundPipelineError} from '../runtime/wbs-mcp-inbound-pipeline.mjs';

const snapshot={snapshot_id:'11111111-1111-4111-8111-111111111111'};
const pullService={pullTransactionSnapshot:async()=>({snapshot,can_persist:false,can_allocate:false,can_create_draft:false,can_post:false})};
const adapter={prepare:value=>({snapshot_id:value.snapshot_id,raw:[],normalized:[],staging:[],exceptions:[]})};
const args={pull:{companyKey:'COMPANY-A'},tenantId:'tenant',entityId:'entity',importBatchId:'batch',idempotencyKey:'stable-key'};

test('verified WBS pull reaches only immutable receipt and Raw/Normalized/Staging persistence with no accounting dispatch',async()=>{
  const calls=[];
  const pipeline=createWbsMcpInboundPipeline({pullService,signatureVerifier:async value=>(calls.push(['verify',value]),true),inboundAdapter:{prepare:value=>(calls.push(['prepare',value]),adapter.prepare(value))},inboundOrchestrator:{persist:async value=>(calls.push(['persist',value]),{plan_fingerprint:'plan',receipt_persistence:{ok:true},row_persistence:{ok:true},can_dispatch_draft:false,can_dispatch_autorec:false,can_post:false})}});
  const result=await pipeline.ingest(args);
  assert.deepEqual(calls.map(([kind])=>kind),['verify','prepare','persist']);assert.deepEqual({status:result.status,draft:result.can_dispatch_draft,autorec:result.can_dispatch_autorec,post:result.can_post},{status:'WBS_MCP_INGESTED_STAGING_REVIEW_REQUIRED',draft:false,autorec:false,post:false});
});

test('failed pull, signature, adapter admission, or unsafe persistence stops the pipeline before accounting authority',async()=>{
  const signatureFailure=createWbsMcpInboundPipeline({pullService,signatureVerifier:async()=>false,inboundAdapter:adapter,inboundOrchestrator:{persist:async()=>{throw new Error('must not call');}}});await assert.rejects(()=>signatureFailure.ingest(args),error=>error instanceof WbsMcpInboundPipelineError&&error.code==='WBS_MCP_SNAPSHOT_SIGNATURE_INVALID');
  const admissionFailure=createWbsMcpInboundPipeline({pullService,signatureVerifier:async()=>true,inboundAdapter:{prepare:()=>{throw new Error('bad');}},inboundOrchestrator:{persist:async()=>{throw new Error('must not call');}}});await assert.rejects(()=>admissionFailure.ingest(args),error=>error.code==='WBS_MCP_ADMISSION_FAILED');
  const unsafe=createWbsMcpInboundPipeline({pullService,signatureVerifier:async()=>true,inboundAdapter:adapter,inboundOrchestrator:{persist:async()=>({can_dispatch_draft:true,can_dispatch_autorec:false,can_post:false})}});await assert.rejects(()=>unsafe.ingest(args),error=>error.code==='WBS_MCP_PERSISTENCE_CONTRACT_INVALID');
});
