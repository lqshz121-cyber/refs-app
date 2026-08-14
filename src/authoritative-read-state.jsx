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

// A successful empty API response is a scope result, not a financial
// conclusion.  Keeping this component separate from failures prevents a zero
// count from being presented as either an access error or a zero balance.
export function AuthoritativeScopeEmpty({subject='records',requiresPosted=false}){
  const prerequisite=requiresPosted
    ? 'Reports and GL remain empty until a signed source is admitted, reviewed, and posted as a Journal entry.'
    : 'This does not prove that an upstream source is empty. It is not evidence of a zero balance.';
  return <StateBlock tone="empty" title="SCOPE_EMPTY — no authoritative records returned">
    <p>The authenticated API returned 0 {subject} for the current entity and period scope.</p>
    <p>{prerequisite}</p>
  </StateBlock>;
}
