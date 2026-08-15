import React from 'react';
import {StateBlock} from './ui.jsx';

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
export function AuthoritativeScopeEmpty({subject='records',requiresPosted=false}){
  const prerequisite=requiresPosted
    ? 'Next step: finance should confirm a signed source, complete review, and post its journal entry. Reports and the general ledger update from posted records only.'
    : 'This view is current for the selected company and reporting period. It does not confirm a zero balance or that upstream source records are empty.';
  return <StateBlock tone="empty" title={requiresPosted?'No posted records yet':'No records in this view'}>
    <p>The selected company and reporting period currently have 0 {subject}.</p>
    <p>{prerequisite}</p>
  </StateBlock>;
}
