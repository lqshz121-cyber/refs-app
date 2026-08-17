const unsupported=()=>Object.freeze({supported:false,reason:'UNSUPPORTED_PROVIDER_TRACE'});

// The API client validates STANDARD_PROVIDER_TRACE data before it reaches this
// adapter. RELEASE_AUDITOR is deliberately opaque: its owner supplies an
// adapter later, rather than letting this UI guess or expose auditor fields.
export const PROVIDER_TRACE_DTO=Object.freeze({STANDARD:'STANDARD_PROVIDER_TRACE',RELEASE_AUDITOR:'RELEASE_AUDITOR'});

export const adaptProviderTraceForUi=trace=>{
  if(!trace||typeof trace!=='object'||Array.isArray(trace)||trace.supported===false)return unsupported();
  if(trace.dto_kind===undefined||trace.dto_kind===PROVIDER_TRACE_DTO.STANDARD){
    if(trace.domain!=='INSURANCE')return trace;
    return {...trace,mapping_decision_id:trace.mapping_decision_id,mapping_decision_hash:trace.mapping_decision_hash,company_mapping_hash:trace.company_mapping_hash};
  }
  return unsupported();
};
