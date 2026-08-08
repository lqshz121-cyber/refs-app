import {buildWbsMcpReadonlySnapshot,WbsMcpLineageError} from './wbs-mcp-inbound-lineage.mjs';

const transactionTools=Object.freeze(['list_payables','list_bank_transactions','list_autorec_details']);
const text=value=>value==null?'':String(value).trim();
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export class WbsMcpInboundServiceError extends Error {
  constructor(code,message){super(message);this.name='WbsMcpInboundServiceError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsMcpInboundServiceError(code,message);};

// This service has exactly one outward capability: read through the injected
// read-only MCP client. It has no repository, Draft, allocation, or posting
// dependency, so a pull cannot mutate WBS or the REFS accounting ledger.
export function createWbsMcpInboundService({client}={}){
  if(!client||typeof client.readView!=='function')throw new WbsMcpInboundServiceError('WBS_MCP_CLIENT_REQUIRED','A configured read-only WBS MCP client is required.');
  return Object.freeze({
    read_only:true,
    tools:transactionTools,
    async pullTransactionSnapshot({companyKey,argsByTool,snapshotId,dictionaryVersion,environment='SANDBOX',delivery=null,detachedSignature=null}={}){
      if(!text(companyKey)||!plain(argsByTool))fail('WBS_MCP_SELECTION_REQUIRED','Company scope and structured MCP arguments are required.');
      if(Object.keys(argsByTool).some(key=>!transactionTools.includes(key))||transactionTools.some(tool=>!plain(argsByTool[tool])))fail('WBS_MCP_SELECTION_REQUIRED','Each transaction producer needs structured arguments and no other MCP tool may be called.');
      const envelopes=[];
      for(const toolName of transactionTools){
        let envelope;try{envelope=await client.readView({toolName,args:structuredClone(argsByTool[toolName])});}catch(cause){
          if(cause instanceof WbsMcpLineageError)throw cause;
          throw new WbsMcpInboundServiceError('WBS_MCP_READ_FAILED',`WBS ${toolName} read failed before any REFS persistence.`);
        }
        if(!envelope||envelope.tool_name!==toolName||text(envelope.scope?.company)!==text(companyKey))fail('WBS_MCP_RESPONSE_SCOPE_INVALID','WBS MCP response is outside the selected company scope.');
        // Reconstruct the validated provider envelope without adding caller
        // controlled values; the snapshot builder validates it again.
        envelopes.push({tool:envelope.tool_name,contract_version:envelope.contract_version,environment:envelope.environment,captured_at:envelope.captured_at,source:structuredClone(envelope.source),scope:structuredClone(envelope.scope),record_count:envelope.record_count,content_sha256:envelope.content_sha256,cursor_next:envelope.cursor_next,etl_notice:envelope.etl_notice,rows:structuredClone(envelope.rows)});
      }
      try{
        const snapshot=buildWbsMcpReadonlySnapshot({envelopes,snapshotId,dictionaryVersion,environment,delivery,detachedSignature});
        return Object.freeze({status:'WBS_MCP_SNAPSHOT_READY_FOR_RECEIPT_VERIFICATION',snapshot,can_persist:false,can_allocate:false,can_create_draft:false,can_post:false,required_next_controls:Object.freeze(['verify detached signature','persist immutable snapshot receipt','persist Raw/Normalized/Staging through REFS kernel','human staging review'])});
      }catch(cause){
        if(cause instanceof WbsMcpLineageError)throw cause;
        throw new WbsMcpInboundServiceError('WBS_MCP_SNAPSHOT_BUILD_FAILED','WBS MCP responses could not form one safe REFS inbound snapshot.');
      }
    }
  });
}
