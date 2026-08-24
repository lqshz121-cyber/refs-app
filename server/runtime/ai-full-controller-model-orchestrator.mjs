import {createHash} from 'node:crypto';
import {buildAiFullControllerScanEvidence} from './ai-full-controller-scan-evidence-contract.mjs';
import {buildAiFullControllerModelInputChunks} from './ai-full-controller-model-input-contract.mjs';
import {createAiFullControllerModelService} from './ai-full-controller-model-service.mjs';
import {canonicalRequestHash} from './request-hash.mjs';

const SHA=/^[0-9a-f]{40}$/;
const HASH=/^sha256:[0-9a-f]{64}$/;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const stableUuid=value=>{
  const bytes=createHash('sha256').update(value,'utf8').digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};

export function createAiFullControllerModelOrchestrator({scanService,gateway,kernel,releaseSha}={}){
  if(!scanService||typeof scanService.analyze!=='function'||!gateway||typeof gateway.analyzeJson!=='function'||!kernel||!SHA.test(releaseSha||''))fail('AI_FULL_CONTROLLER_MODEL_ORCHESTRATOR_UNAVAILABLE','Full Controller model orchestration requires the authoritative scan, controlled gateway, durable kernel, and exact release SHA.');
  return Object.freeze({
    async analyze({tenantId,entityId,accountingPeriodId,actorId,idempotencyKey,limit=500}={}){
      if(typeof kernel.prepareAiFullControllerModelRun!=='function')fail('AI_FULL_CONTROLLER_MODEL_ORCHESTRATOR_UNAVAILABLE','Full Controller model orchestration requires durable pre-scan idempotency reservation.');
      const request=Object.freeze({schema_version:'AI_FULL_CONTROLLER_MODEL_RUN_SCOPE_V1',tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId,release_sha:releaseSha,requested_limit:limit});
      const expectedRequestHash=canonicalRequestHash(request),prepared=await kernel.prepareAiFullControllerModelRun({tenantId,entityId,accountingPeriodId,actorId,idempotencyKey,request});
      if(!HASH.test(expectedRequestHash)||prepared?.requestHash!==expectedRequestHash||!['PREPARED','RESUME','REPLAY'].includes(prepared?.state))fail('AI_FULL_SCAN_MODEL_RUN_INVALID','Durable pre-scan reservation is not bound to the exact request scope.');
      const preparedKeys=prepared.state==='PREPARED'?['preparedAt','requestHash','state']:prepared.state==='RESUME'?['inputManifest','preparedAt','requestHash','runHash','state']:['inputManifest','output','preparedAt','requestHash','runHash','state'];
      if(!exact(prepared,preparedKeys)||typeof prepared.preparedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(prepared.preparedAt)||!Number.isFinite(Date.parse(prepared.preparedAt))||new Date(prepared.preparedAt).toISOString()!==prepared.preparedAt||(prepared.state!=='PREPARED'&&!HASH.test(prepared.runHash||'')))fail('AI_FULL_SCAN_MODEL_RUN_INVALID','Durable pre-scan reservation returned an open or incomplete receipt.');
      let inputManifest=prepared.inputManifest;
      if(!inputManifest){
        const capturedAt=new Date(prepared.preparedAt).toISOString();
        if(capturedAt!==prepared.preparedAt)fail('AI_FULL_SCAN_MODEL_RUN_INVALID','Durable pre-scan reservation time is not canonical UTC.');
        const scan=await scanService.analyze({tenantId,entityId,currentAccountingPeriodId:accountingPeriodId,limit});
        const evidenceSnapshot=buildAiFullControllerScanEvidence({tenantId,entityId,accountingPeriodId,releaseSha,capturedAt,requestedLimit:limit,scan});
        const retainedFindingIds=evidenceSnapshot.sections.flatMap(section=>section.findings.map(finding=>Object.freeze({finding_id:stableUuid(`${expectedRequestHash}:finding:${section.category}:${finding.finding_index}:${finding.finding_hash}`),section_category:section.category,finding_index:finding.finding_index,finding_hash:finding.finding_hash})));
        inputManifest=buildAiFullControllerModelInputChunks({snapshotId:stableUuid(`${expectedRequestHash}:snapshot:${evidenceSnapshot.snapshot_hash}`),evidenceSnapshot,retainedFindingIds});
      }
      const bind=method=>input=>kernel[method]({...input,tenantId});
      const repository=Object.freeze(Object.fromEntries(['beginAiFullControllerModelRun','beginAiFullControllerModelChunk','completeAiFullControllerModelChunk','beginAiFullControllerModelMemo','completeAiFullControllerModelRun','abandonAiFullControllerModelStage'].map(method=>[method,bind(method)])));
      return createAiFullControllerModelService({gateway,repository}).analyze({actorId,idempotencyKey,inputManifest});
    }
  });
}
