import React from 'react';
import {StateBlock} from './ui.jsx';

// These failures mean the browser cannot establish a trustworthy authoritative
// read for the current scope. Transport and service failures intentionally
// remain ordinary errors: they do not prove that access or evidence is absent.
export const AUTHORITATIVE_READ_BLOCKED_CODES=Object.freeze([
  'AUTHENTICATION_REQUIRED',
  'AUTHORIZATION_DENIED',
  'ACCOUNTING_API_SCOPE_INVALID',
  'ACCOUNTING_API_PROTOCOL',
  'CONFIGURATION_REQUIRED',
]);

export const authoritativeReadFailurePhase=failure=>AUTHORITATIVE_READ_BLOCKED_CODES.includes(failure?.code)?'BLOCKED':'ERROR';

export function AuthoritativeReadFailure({state,onRetry,retryLabel='Retry report read'}){
  if(!['BLOCKED','ERROR'].includes(state?.phase))return null;
  const blocked=state.phase==='BLOCKED';
  const code=state.error?.code||'AUTHORITATIVE_READ_FAILED';
  return <StateBlock tone={blocked?'blocked':'error'} title={blocked?'BLOCKED — authoritative evidence unavailable':code} actions={<button type="button" className="btn btn-sm" onClick={onRetry}>{blocked?'Retry read-only evidence':retryLabel}</button>}>
    <p>{blocked?`${code}: ${state.error?.message||'The authoritative read could not establish a trusted scope.'}`:state.error?.message}</p>
    {blocked&&<p>Keep the current report scope and resolve the authoritative access, configuration, scope, or protocol issue before treating this view as accounting evidence.</p>}
  </StateBlock>;
}
