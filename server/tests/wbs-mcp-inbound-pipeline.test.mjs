import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createWbsMcpInboundPipeline,WbsMcpInboundPipelineError} from '../runtime/wbs-mcp-inbound-pipeline.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildWbsMcpReadonlySnapshot} from '../runtime/wbs-mcp-inbound-lineage.mjs';
import {createWbsInboundDataAdapterWithKeyring} from '../runtime/wbs-inbound-data-adapter.mjs';
import {createWbsSnapshotSignatureVerifier} from '../runtime/wbs-snapshot-signature.mjs';

const snapshot={snapshot_id:'11111111-1111-4111-8111-111111111111'};
const pullService={pullTransactionSnapshot:async()=>({snapshot,can_persist:false,can_allocate:false,can_create_draft:false,can_post:false})};
const adapter={prepareVerified:async value=>({snapshot_id:value.snapshot_id,raw:[],normalized:[],staging:[],exceptions:[]})};
const args={pull:{companyKey:'COMPANY-A'},tenantId:'tenant',entityId:'entity',importBatchId:'batch',idempotencyKey:'stable-key'};
const productionEnvelope=rows=>({contract_version:'WBS-REFS-MCP-V1',tool:'list_payables',environment:'production',captured_at:'2026-08-09T12:00:00.000Z',source:{system:'WBS'},scope:{company:'COMPANY-A',currency:'USD'},record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,etl_notice:'Snapshot comparison required',rows});

test('verified WBS pull reaches only immutable receipt and Raw/Normalized/Staging persistence with no accounting dispatch',async()=>{
  const calls=[];
  const pipeline=createWbsMcpInboundPipeline({pullService,signatureVerifier:async value=>(calls.push(['verify',value]),true),inboundAdapter:{prepareVerified:async value=>(calls.push(['prepareVerified',value]),adapter.prepareVerified(value))},inboundOrchestrator:{persist:async value=>(calls.push(['persist',value]),{plan_fingerprint:'plan',receipt_persistence:{ok:true},row_persistence:{ok:true},can_dispatch_draft:false,can_dispatch_autorec:false,can_post:false})}});
  const result=await pipeline.ingest(args);
  assert.deepEqual(calls.map(([kind])=>kind),['verify','prepareVerified','persist']);assert.deepEqual({status:result.status,draft:result.can_dispatch_draft,autorec:result.can_dispatch_autorec,post:result.can_post},{status:'WBS_MCP_INGESTED_STAGING_REVIEW_REQUIRED',draft:false,autorec:false,post:false});
});

test('failed pull, signature, adapter admission, or unsafe persistence stops the pipeline before accounting authority',async()=>{
  assert.throws(()=>createWbsMcpInboundPipeline({pullService,signatureVerifier:async()=>true,inboundAdapter:{prepare:()=>({})},inboundOrchestrator:{persist:async()=>({})}}),error=>error.code==='WBS_MCP_PIPELINE_DEPENDENCY_REQUIRED');
  const signatureFailure=createWbsMcpInboundPipeline({pullService,signatureVerifier:async()=>false,inboundAdapter:adapter,inboundOrchestrator:{persist:async()=>{throw new Error('must not call');}}});await assert.rejects(()=>signatureFailure.ingest(args),error=>error instanceof WbsMcpInboundPipelineError&&error.code==='WBS_MCP_SNAPSHOT_SIGNATURE_INVALID');
  const admissionFailure=createWbsMcpInboundPipeline({pullService,signatureVerifier:async()=>true,inboundAdapter:{prepareVerified:async()=>{throw new Error('bad');}},inboundOrchestrator:{persist:async()=>{throw new Error('must not call');}}});await assert.rejects(()=>admissionFailure.ingest(args),error=>error.code==='WBS_MCP_ADMISSION_FAILED');
  const unsafe=createWbsMcpInboundPipeline({pullService,signatureVerifier:async()=>true,inboundAdapter:adapter,inboundOrchestrator:{persist:async()=>({can_dispatch_draft:true,can_dispatch_autorec:false,can_post:false})}});await assert.rejects(()=>unsafe.ingest(args),error=>error.code==='WBS_MCP_PERSISTENCE_CONTRACT_INVALID');
});

test('a real Ed25519 production snapshot must pass both pipeline and adapter keyring verification before persistence',async()=>{
  const pair=generateKeyPairSync('ed25519'),keyId='wbs-prod-pipeline-test',publicKeys={[keyId]:pair.publicKey.export({type:'spki',format:'pem'})};
  const rows=[{ap_guid:'11111111-1111-4111-8111-111111111111',ap_type:'AUTOC',company_code:'COMPANY-A',currency:'USD',amount:'100.0000',posting_date:'2026-08-09'}],envelope=productionEnvelope(rows);
  const direction=[{scope:{company_key:'COMPANY-A',currency:'USD'},receipt:{hash:`sha256:${envelope.content_sha256}`,ref:'object://wbs/payable/receipt',version:'v1',verification_id:'verify-1',key_id:keyId,algorithm:'Ed25519',verified_on:'2026-08-09T12:00:00.000Z'},rule_id:'WBS-PAYABLE-DR-1',version:'1',ap_type:'AUTOC',direction:'DEBIT'}];
  const unsigned=buildWbsMcpReadonlySnapshot({envelopes:[envelope],snapshotId:'22222222-2222-4222-8222-222222222222',dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:'2026-08-09T11:59:00.000Z',extract_completed_at:'2026-08-09T12:00:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detachedSignature:{key_id:keyId,algorithm:'Ed25519',value:'placeholder'},payableDirectionConventions:direction});
  const signed={...unsigned,detached_signature:{...unsigned.detached_signature,value:sign(null,Buffer.from(unsigned.package_hash),pair.privateKey).toString('base64')}};
  const persisted=[],snapshotReader={readOnly:true,readSnapshot:async()=>{throw new Error('pipeline supplies the already-read snapshot');}};
  const pipeline=createWbsMcpInboundPipeline({pullService:{pullTransactionSnapshot:async()=>({snapshot:signed,can_persist:false,can_allocate:false,can_create_draft:false,can_post:false})},signatureVerifier:createWbsSnapshotSignatureVerifier({publicKeys}),inboundAdapter:createWbsInboundDataAdapterWithKeyring({snapshotReader,wbsPublicKeys:publicKeys}),inboundOrchestrator:{persist:async value=>(persisted.push(value),{plan_fingerprint:'plan',receipt_persistence:{ok:true},row_persistence:{ok:true},can_dispatch_draft:false,can_dispatch_autorec:false,can_post:false})}});
  const result=await pipeline.ingest(args);
  assert.equal(result.status,'WBS_MCP_INGESTED_STAGING_REVIEW_REQUIRED');assert.equal(persisted.length,1);assert.equal(persisted[0].prepared.staging.length,1);
  const tampered={...signed,detached_signature:{...signed.detached_signature,value:'not-a-valid-signature'}};
  const rejected=createWbsMcpInboundPipeline({pullService:{pullTransactionSnapshot:async()=>({snapshot:tampered,can_persist:false,can_allocate:false,can_create_draft:false,can_post:false})},signatureVerifier:createWbsSnapshotSignatureVerifier({publicKeys}),inboundAdapter:createWbsInboundDataAdapterWithKeyring({snapshotReader,wbsPublicKeys:publicKeys}),inboundOrchestrator:{persist:async()=>{throw new Error('must not persist');}}});
  await assert.rejects(()=>rejected.ingest(args),error=>error.code==='WBS_MCP_SNAPSHOT_SIGNATURE_INVALID');
});
