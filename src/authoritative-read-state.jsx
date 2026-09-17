import React,{useEffect,useState} from 'react';
import {StateBlock} from './ui.jsx';
import {refreshEntityEvidenceSummary} from './accounting-api.js';

// These failures mean the browser cannot establish a trustworthy authoritative
// read for the current scope. Transport and service failures intentionally
// remain ordinary errors: they do not prove that access or evidence is absent.
export const AUTHORITATIVE_READ_BLOCKED_CODES=Object.freeze([
  'AUTHENTICATION_REQUIRED',
  'AUTHORIZATION_DENIED',
  'ACCOUNTING_API_SCOPE_INVALID',
  'ACCOUNTING_API_SCOPE_NOT_FOUND',
  'ACCOUNTING_API_PROTOCOL',
  'CONFIGURATION_REQUIRED',
]);

export const authoritativeReadFailurePhase=failure=>AUTHORITATIVE_READ_BLOCKED_CODES.includes(failure?.code)?'BLOCKED':'ERROR';

// A zero row count and a failed GET are materially different accounting facts.
// Keep the names here so AP, AR, Bank, GL, and Reports use the same clear
// diagnosis instead of implying that inaccessible evidence is an empty ledger.
export const authoritativeReadFailureDiagnostic=failure=>{
  const code=failure?.code||'AUTHORITATIVE_READ_FAILED';
  if(code==='ACCOUNTING_API_SCOPE_NOT_FOUND')return {status:'SCOPE_UNAVAILABLE',title:'SCOPE_UNAVAILABLE: the API could not find this configured scope',next:'Check the configured entity and period with an administrator, then refresh.'};
  const known={
    AUTHENTICATION_REQUIRED:{status:'SIGN_IN_REQUIRED',title:'SIGN_IN_REQUIRED — authenticate to read this scope',next:'Sign in again, then refresh this read-only view.'},
    AUTHORIZATION_DENIED:{status:'NO_PERMISSION',title:'NO_PERMISSION — this account cannot read this scope',next:'Ask an administrator for read access to this entity, then refresh.'},
    ACCOUNTING_API_SCOPE_INVALID:{status:'SCOPE_INVALID',title:'SCOPE_INVALID — the configured entity or period cannot be read',next:'Choose or configure a valid entity and period, then refresh.'},
    CONFIGURATION_REQUIRED:{status:'API_CONFIGURATION_REQUIRED',title:'API_CONFIGURATION_REQUIRED — the authoritative reader is not configured',next:'Ask the deployment owner to configure the authoritative API, then refresh.'},
    ACCOUNTING_API_PROTOCOL:{status:'API_PROTOCOL_ERROR',title:'API_PROTOCOL_ERROR — the server response cannot be used as accounting evidence',next:'Ask the API owner to correct the response contract, then refresh.'},
    // O07: transport and service failures are named so a 5xx or an unreachable host is never read as "no data".
    ACCOUNTING_API_UNREACHABLE:{status:'SERVICE_UNREACHABLE',title:'SERVICE_UNREACHABLE — the browser got no HTTP response from the accounting API',next:'Check network and service status, then retry. Nothing below is accounting evidence.'},
    ACCOUNTING_API_SERVER_ERROR:{status:'SERVICE_ERROR',title:'SERVICE_ERROR — the accounting API failed to answer this read',next:'Retry the read; if it persists, ask the API owner to check service health and dependencies (database, external connectors).'},
    ACCOUNTING_API_RATE_LIMITED:{status:'RATE_LIMITED',title:'RATE_LIMITED — the accounting API is throttling this client',next:'Wait a moment and retry.'},
    ACCOUNTING_API_REQUEST_REJECTED:{status:'REQUEST_REJECTED',title:'REQUEST_REJECTED — the accounting API rejected this read request',next:'The request parameters or scope are not acceptable to the API; check the configured scope and filters, then retry.'},
  };
  return known[code]||{status:'API_ERROR',title:'API_ERROR — authoritative data could not be read',next:'Retry the read. If it continues, ask the API owner to check service health and this entity scope.'};
};

export function AuthoritativeReadFailure({state,onRetry,retryLabel='Retry report read'}){
  if(!['BLOCKED','ERROR'].includes(state?.phase))return null;
  const blocked=state.phase==='BLOCKED';
  const code=state.error?.code||'AUTHORITATIVE_READ_FAILED';
  const diagnostic=authoritativeReadFailureDiagnostic(state.error);
  return <StateBlock tone={blocked?'blocked':'error'} title={diagnostic.title} actions={<button type="button" className="btn btn-sm" onClick={onRetry}>{blocked?'Retry read-only evidence':retryLabel}</button>}>
    <p><b>{diagnostic.status}</b>: {code}{state.error?.message?`: ${state.error.message}`:''}</p>
    <p>{diagnostic.next}</p>
    {blocked&&<p>Do not treat this view as accounting evidence until the access, configuration, scope, or protocol issue is resolved.</p>}
  </StateBlock>;
}

// A successful empty API response is a scope result, not a financial
// conclusion. Keeping this component separate from failures prevents a zero
// count from being presented as either an access error or a zero balance.
export function AuthoritativeScopeEmpty({subject='records',requiresPosted=false,evidence=null}){
  // P0-F6: when the API's evidence summary says nothing was ever imported for this
  // entity/period, say so instead of presenting an empty query as accounting state.
  if(evidence?.evidence_state==='NO_EVIDENCE_IMPORTED'){
    return <StateBlock tone="empty" title="NO_EVIDENCE_IMPORTED — nothing has been imported for this entity and period">
      <p>The authenticated API found 0 journals, 0 raw WBS events, 0 staging items and 0 source documents for this scope. Nothing was ever imported here; this is not a zero balance and no figures were substituted.</p>
      <p>Next step: an authorised import must admit source evidence for this entity (staging keeps WBS ingestion disabled unless the Owner enables it). Choose another entity or period to review existing evidence.</p>
    </StateBlock>;
  }
  if(evidence?.evidence_state==='EVIDENCE_WITHOUT_POSTINGS'&&requiresPosted){
    return <StateBlock tone="empty" title="EVIDENCE_WITHOUT_POSTINGS — imported evidence exists but nothing is posted yet">
      <p>The authenticated API found {evidence.journal_count} journal{evidence.journal_count===1?'':'s'} (0 posted), {evidence.raw_event_count} raw events and {evidence.staging_item_count} staging items for this scope.</p>
      <p>Next step: complete review and post the pending Journal entries. Reports and GL read posted evidence only.</p>
    </StateBlock>;
  }
  const prerequisite=requiresPosted
    ? 'Next step: admit a signed source, complete review, and post its Journal entry. Reports and GL read posted evidence only.'
    : 'This is a successful query for the current scope. It does not prove that an upstream source is empty. It is not evidence of a zero balance.';
  return <StateBlock tone="empty" title={requiresPosted?'INGESTION_BLOCKED — no posted authoritative evidence':'SCOPE_EMPTY — no authoritative records returned'}>
    <p>The authenticated API returned 0 {subject} for the current entity and period scope.</p>
    <p>{prerequisite}</p>
  </StateBlock>;
}

// O04: shared hook — only while a POSTED-only read returned nothing, ask the API whether anything was ever imported
// for this entity/period so the empty state can say NO_EVIDENCE_IMPORTED / EVIDENCE_WITHOUT_POSTINGS instead of
// an ambiguous blank. Any failure (403 without GL.REPORT.VIEW, 404 on an older API) yields null → generic copy.
export function useEntityEvidenceWhenEmpty({config,fetcher,empty}){
  const [evidence,setEvidence]=useState(null);
  useEffect(()=>{let current=true;if(!empty){setEvidence(null);return ()=>{current=false;};}
    Promise.resolve().then(()=>refreshEntityEvidenceSummary({config,fetcher})).then(result=>{if(current)setEvidence(result?.ok?result.row:null);}).catch(()=>{if(current)setEvidence(null);});
    return ()=>{current=false;};},[empty,config,fetcher]);
  return evidence;
}
