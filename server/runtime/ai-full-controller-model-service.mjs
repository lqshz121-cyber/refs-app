import {assertAiFullControllerModelInputManifest,buildAiFullControllerModelOutput,sealAiFullControllerModelChunkResponse} from './ai-full-controller-model-output-contract.mjs';
import {buildAiFullControllerMemoReduction} from './ai-full-controller-memo-reduction-contract.mjs';
import {safeAiEvidenceTree} from './ai-secret-safety.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const METHODS=['beginAiFullControllerModelRun','beginAiFullControllerModelChunk','completeAiFullControllerModelChunk','beginAiFullControllerModelMemo','completeAiFullControllerModelRun','abandonAiFullControllerModelStage'];
const fail=(code,message,cause)=>{throw Object.assign(new Error(message,{cause}),{code});};
const resultSchema=(name,maxActions=100)=>Object.freeze({name,schema:{type:'object',additionalProperties:false,properties:{headline:{type:'string',minLength:1,maxLength:500},narrative:{type:'string',minLength:1,maxLength:12000},risk_summary:{type:'object',additionalProperties:false,properties:{high:{type:'integer',minimum:0},medium:{type:'integer',minimum:0},low:{type:'integer',minimum:0}},required:['high','medium','low']},controller_actions:{type:'array',maxItems:maxActions,items:{type:'object',additionalProperties:false,properties:{category:{type:'string',pattern:'^[A-Z][A-Z0-9_]{2,127}$'},finding_ids:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:{type:'string',format:'uuid'}},action:{type:'string',minLength:1,maxLength:2000}},required:['category','finding_ids','action']}},action_flags:{type:'object',additionalProperties:false,properties:{can_create_draft:{const:false},can_review:{const:false},can_approve:{const:false},can_post:{const:false}},required:['can_create_draft','can_review','can_approve','can_post']}},required:['headline','narrative','risk_summary','controller_actions','action_flags']}});
const chunkSchema=resultSchema('refs_ai_full_controller_chunk');
const memoSchema=resultSchema('refs_ai_full_controller_memo');
const modelMetadata=output=>({provider_request_id:output.providerRequestId??null,model:output.model,elapsed_ms:output.elapsedMs,trace_id:output.traceId});
const chunkResponse=(manifest,index,output)=>({schema_version:'AI_FULL_CONTROLLER_MODEL_CHUNK_RESPONSE_V1',snapshot_id:manifest.snapshot_id,snapshot_hash:manifest.snapshot_hash,chunk_index:index,chunk_hash:manifest.chunk_hashes[index],...output.result,model_metadata:modelMetadata(output)});
const memoResponse=(manifest,hashes,reduction,output)=>({schema_version:'AI_FULL_CONTROLLER_MEMO_V1',snapshot_id:manifest.snapshot_id,snapshot_hash:manifest.snapshot_hash,chunk_response_hashes:hashes,memo_reduction_hash:reduction.reduction_hash,memo_citation_finding_ids:[...new Set(reduction.root_nodes.flatMap(node=>node.priority_findings.map(item=>item.finding_id)))],...output.result,model_metadata:modelMetadata(output)});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const assertGatewayOutput=(output,expectedTraceId)=>{
  if(!exact(output,['elapsedMs','model','providerRequestId','result','traceId'])||output.traceId!==expectedTraceId||typeof output.model!=='string'||output.model.trim()!==output.model||output.model.length<1||output.model.length>255||(output.providerRequestId!==null&&(typeof output.providerRequestId!=='string'||output.providerRequestId.trim()!==output.providerRequestId||output.providerRequestId.length<1||output.providerRequestId.length>255))||!Number.isSafeInteger(output.elapsedMs)||output.elapsedMs<0||output.elapsedMs>86_400_000||!output.result||typeof output.result!=='object'||Array.isArray(output.result)||!safeAiEvidenceTree(output))fail('AI_FULL_SCAN_MODEL_TRACE_INVALID','Controlled model output must carry the exact idempotency-bound trace and closed gateway receipt.');
  return output;
};

export function createAiFullControllerModelService({gateway,repository}={}){
  if(!gateway||typeof gateway.analyzeJson!=='function')fail('AI_FULL_SCAN_MODEL_GATEWAY_REQUIRED','Full Controller model execution requires the controlled AI gateway.');
  if(!repository||METHODS.some(method=>typeof repository[method]!=='function'))fail('AI_FULL_SCAN_MODEL_REPOSITORY_REQUIRED','Full Controller model execution requires durable run, chunk, memo, and recovery receipts.');
  return Object.freeze({
    async analyze({actorId,idempotencyKey,inputManifest}={}){
      if(typeof actorId!=='string'||actorId.length<1||actorId.length>255||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200||!safeAiEvidenceTree({actor_id:actorId,idempotency_key:idempotencyKey}))fail('AI_FULL_SCAN_MODEL_RUN_INVALID','Model execution requires one safe authenticated actor and stable idempotency key.');
      assertAiFullControllerModelInputManifest(inputManifest);
      const run=await repository.beginAiFullControllerModelRun({actorId,idempotencyKey,inputManifest});
      if(run?.state==='REPLAY'){if(!exact(run,['output','state']))fail('AI_FULL_SCAN_MODEL_RUN_INVALID','Durable replay receipt is not closed.');return buildAiFullControllerModelOutput({inputManifest,chunkResponses:run.output?.chunk_responses,finalMemo:run.output?.final_memo});}
      if(!exact(run,['runHash','state'])||run.state!=='STARTED'||!/^sha256:[0-9a-f]{64}$/.test(run.runHash||''))fail('AI_FULL_SCAN_MODEL_RUN_INVALID','Durable model run reservation was not established.');
      const responses=[];
      try{
        for(const [index,chunk] of inputManifest.chunks.entries()){
          const reservation=await repository.beginAiFullControllerModelChunk({actorId,idempotencyKey,runHash:run.runHash,chunkIndex:index,chunkHash:chunk.chunk_hash});
          if(reservation?.state==='STARTED'?!exact(reservation,['state']):reservation?.state==='REPLAY'?!exact(reservation,['response','state']):true)fail('AI_FULL_SCAN_MODEL_CHUNK_RECEIPT_INVALID','Durable chunk reservation was not established.');
          let sealed;
          if(reservation.state==='REPLAY')sealed=sealAiFullControllerModelChunkResponse({inputManifest,response:reservation.response,index});
          else{
            const traceId=`${idempotencyKey}:chunk:${index}`,output=assertGatewayOutput(await gateway.analyzeJson({traceId,traceName:'refs-ai-full-controller-chunk',actorId,facts:chunk,systemInstruction:'Analyze only the retained findings in this exact chunk. Cite every provided finding UUID exactly once under its provided category. Do not invent facts, sources, balances, journal entries, approvals, or authority. All action flags must remain false.',jsonSchema:chunkSchema}),traceId);
            sealed=sealAiFullControllerModelChunkResponse({inputManifest,response:chunkResponse(inputManifest,index,output),index});
            const persisted=await repository.completeAiFullControllerModelChunk({actorId,idempotencyKey,runHash:run.runHash,chunkIndex:index,chunkHash:chunk.chunk_hash,response:sealed});
            sealed=sealAiFullControllerModelChunkResponse({inputManifest,response:persisted,index});
          }
          responses.push(sealed);
        }
        const hashes=responses.map(item=>item.response_hash),reduction=buildAiFullControllerMemoReduction({inputManifest,sealedChunkResponses:responses}),memoReservation=await repository.beginAiFullControllerModelMemo({actorId,idempotencyKey,runHash:run.runHash,chunkResponseHashes:hashes,reductionManifest:reduction});
        if(memoReservation?.state==='STARTED'?!exact(memoReservation,['state']):memoReservation?.state==='REPLAY'?!exact(memoReservation,['response','state']):true)fail('AI_FULL_SCAN_MODEL_MEMO_RECEIPT_INVALID','Durable memo reservation was not established.');
        let finalMemo;
        if(memoReservation.state==='REPLAY')finalMemo=memoReservation.response;
        else{
          const traceId=`${idempotencyKey}:memo`,output=assertGatewayOutput(await gateway.analyzeJson({traceId,traceName:'refs-ai-full-controller-memo',actorId,facts:{schema_version:'AI_FULL_CONTROLLER_MEMO_INPUT_V1',snapshot_id:inputManifest.snapshot_id,snapshot_hash:inputManifest.snapshot_hash,memo_reduction_hash:reduction.reduction_hash,total_finding_count:reduction.total_finding_count,risk_summary:reduction.risk_summary,root_nodes:reduction.root_nodes,action_flags:ACTIONS},systemInstruction:'Synthesize only this complete hash-bound reduction of validated chunk responses. Cite only retained priority finding UUIDs present in the reduction roots. Do not invent evidence, accounting effects, approvals, or authority. All action flags must remain false.',jsonSchema:memoSchema}),traceId);
          finalMemo=memoResponse(inputManifest,hashes,reduction,output);
        }
        const result=buildAiFullControllerModelOutput({inputManifest,chunkResponses:responses,finalMemo});
        const persisted=await repository.completeAiFullControllerModelRun({actorId,idempotencyKey,runHash:run.runHash,output:result});
        if(!persisted||typeof persisted!=='object')fail('AI_FULL_SCAN_MODEL_RUN_INVALID','Durable model run completion did not return retained output.');
        return buildAiFullControllerModelOutput({inputManifest,chunkResponses:persisted.chunk_responses,finalMemo:persisted.final_memo});
      }catch(error){
        await repository.abandonAiFullControllerModelStage({actorId,idempotencyKey,runHash:run.runHash,errorCode:error?.code||'AI_FULL_SCAN_MODEL_EXECUTION_FAILED'}).catch(()=>{});
        if(/^AI_FULL_SCAN_MODEL_/.test(error?.code||''))throw error;
        fail('AI_FULL_SCAN_MODEL_EXECUTION_FAILED','Full Controller model execution failed closed.',error);
      }
    }
  });
}
