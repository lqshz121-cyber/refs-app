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
  if(code==='ACCOUNTING_API_SCOPE_NOT_FOUND')return {title:'This company or reporting period is not available',next:'Check the company and reporting period with an administrator, then try again.'};
  const known={
    AUTHENTICATION_REQUIRED:{title:'Please sign in again',next:'Your session has ended. Sign in again, then try this view.'},
    AUTHORIZATION_DENIED:{title:'You need access to view these records',next:'Ask an administrator for access to this company, then try again.'},
    ACCOUNTING_API_SCOPE_INVALID:{title:'Choose a valid company and reporting period',next:'Update the company or reporting period, then try again.'},
    CONFIGURATION_REQUIRED:{title:'This workspace is still being set up',next:'Your implementation team needs to finish connecting this workspace. Try again once setup is complete.'},
    ACCOUNTING_API_PROTOCOL:{title:'These records cannot be verified yet',next:'Your implementation team needs to correct the records connection before this view can be used.'},
  };
  return known[code]||{title:'We could not load these records',next:'Try again. If the issue continues, ask your administrator to check the records connection for this company.'};
};

export function AuthoritativeReadFailure({state,onRetry,retryLabel='Retry report read'}){
  if(!['BLOCKED','ERROR'].includes(state?.phase))return null;
  const blocked=state.phase==='BLOCKED';
  const diagnostic=authoritativeReadFailureDiagnostic(state.error);
  return <StateBlock tone={blocked?'blocked':'error'} title={diagnostic.title} actions={<button type="button" className="btn btn-sm" onClick={onRetry}>{blocked?'Retry read-only evidence':retryLabel}</button>}>
    {state.error?.message&&<p>{state.error.message}</p>}
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
