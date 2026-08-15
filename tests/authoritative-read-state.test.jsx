import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeReadFailure,AuthoritativeScopeEmpty,authoritativeReadFailureDiagnostic,authoritativeReadFailurePhase} from '../src/authoritative-read-state.jsx';

for(const code of ['AUTHENTICATION_REQUIRED','AUTHORIZATION_DENIED','ACCOUNTING_API_SCOPE_INVALID','ACCOUNTING_API_SCOPE_NOT_FOUND','ACCOUNTING_API_PROTOCOL','CONFIGURATION_REQUIRED'])assert.equal(authoritativeReadFailurePhase({code}),'BLOCKED',`${code} must fail closed as an authoritative-read boundary`);
for(const code of ['ACCOUNTING_API_UNREACHABLE','ACCOUNTING_API_SERVER_ERROR','HTTP_503',undefined])assert.equal(authoritativeReadFailurePhase({code}),'ERROR',`${code||'missing code'} must remain an ordinary retriable service error`);

const blocked=renderToStaticMarkup(<AuthoritativeReadFailure state={{phase:'BLOCKED',error:{code:'AUTHORIZATION_DENIED',message:'Current entity is not admitted.'}}} onRetry={()=>{}}/>);
assert.match(blocked,/NO_PERMISSION — this account cannot read this scope/);
assert.match(blocked,/NO_PERMISSION<\/b>: AUTHORIZATION_DENIED: Current entity is not admitted\./);
assert.match(blocked,/Ask an administrator for read access to this entity/);
assert.match(blocked,/Retry read-only evidence/);

const serviceError=renderToStaticMarkup(<AuthoritativeReadFailure state={{phase:'ERROR',error:{code:'ACCOUNTING_API_UNREACHABLE',message:'Gateway unavailable.'}}} onRetry={()=>{}}/>);
assert.match(serviceError,/ACCOUNTING_API_UNREACHABLE/);
assert.match(serviceError,/Gateway unavailable\./);
assert.match(serviceError,/API_ERROR — authoritative data could not be read/);
assert.match(serviceError,/Retry report read/);
assert.doesNotMatch(serviceError,/NO_PERMISSION/);
assert.equal(authoritativeReadFailureDiagnostic({code:'AUTHENTICATION_REQUIRED'}).status,'SIGN_IN_REQUIRED');
assert.equal(authoritativeReadFailureDiagnostic({code:'ACCOUNTING_API_SCOPE_INVALID'}).status,'SCOPE_INVALID');
assert.equal(authoritativeReadFailureDiagnostic({code:'ACCOUNTING_API_SCOPE_NOT_FOUND'}).status,'SCOPE_UNAVAILABLE');
assert.equal(authoritativeReadFailureDiagnostic({code:'ACCOUNTING_API_SERVER_ERROR'}).status,'API_ERROR');

const postedEmpty=renderToStaticMarkup(<AuthoritativeScopeEmpty subject="POSTED ledger lines" requiresPosted/>);
assert.match(postedEmpty,/No posted records yet/);
assert.match(postedEmpty,/Next step: finance should confirm a signed source, complete review, and post its journal entry/);

const scopeEmpty=renderToStaticMarkup(<AuthoritativeScopeEmpty subject="AP bills"/>);
assert.match(scopeEmpty,/No records in this view/);
assert.match(scopeEmpty,/does not confirm a zero balance or that upstream source records are empty/);
console.log('authoritative read failure classification and scoped retry states passed');
