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

export function AuthoritativeReadFailure({state,onRetry}){
  if(!['BLOCKED','ERROR'].includes(state?.phase))return null;
  const blocked=state.phase==='BLOCKED';
  return <StateBlock tone={blocked?'blocked':'error'} title={blocked?'Access needed':'Unable to load this information'} actions={<button type="button" className="btn btn-sm" onClick={onRetry}>Try again</button>}>
    <p>{state.error?.message||(blocked?'This information is not available for the current company and period.':'Please try again in a moment.')}</p>
    {blocked&&<p>Ask your administrator to confirm your access to this company and period, then try again.</p>}
  </StateBlock>;
}

// A successful empty API response is a scope result, not a financial
// conclusion.  Keeping this component separate from failures prevents a zero
// count from being presented as either an access error or a zero balance.
export function AuthoritativeScopeEmpty({subject='records',requiresPosted=false}){
  const prerequisite=requiresPosted
    ? 'Related transactions must be reviewed and posted before they appear here.'
    : 'This does not confirm a zero balance or that no activity has occurred.';
  return <StateBlock tone="empty" title="No records to show">
    <p>No {subject} are available for the current company and period.</p>
    <p>{prerequisite}</p>
  </StateBlock>;
}
