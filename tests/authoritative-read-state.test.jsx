import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeReadFailure,authoritativeReadFailurePhase} from '../src/authoritative-read-state.jsx';

for(const code of ['AUTHENTICATION_REQUIRED','AUTHORIZATION_DENIED','ACCOUNTING_API_SCOPE_INVALID','ACCOUNTING_API_PROTOCOL','CONFIGURATION_REQUIRED'])assert.equal(authoritativeReadFailurePhase({code}),'BLOCKED',`${code} must fail closed as an authoritative-read boundary`);
for(const code of ['ACCOUNTING_API_UNREACHABLE','ACCOUNTING_API_SERVER_ERROR','HTTP_503',undefined])assert.equal(authoritativeReadFailurePhase({code}),'ERROR',`${code||'missing code'} must remain an ordinary retriable service error`);

const blocked=renderToStaticMarkup(<AuthoritativeReadFailure state={{phase:'BLOCKED',error:{code:'AUTHORIZATION_DENIED',message:'Current entity is not admitted.'}}} onRetry={()=>{}}/>);
assert.match(blocked,/BLOCKED — authoritative evidence unavailable/);
assert.match(blocked,/AUTHORIZATION_DENIED: Current entity is not admitted\./);
assert.match(blocked,/Retry read-only evidence/);

const serviceError=renderToStaticMarkup(<AuthoritativeReadFailure state={{phase:'ERROR',error:{code:'ACCOUNTING_API_UNREACHABLE',message:'Gateway unavailable.'}}} onRetry={()=>{}}/>);
assert.match(serviceError,/ACCOUNTING_API_UNREACHABLE/);
assert.match(serviceError,/Gateway unavailable\./);
assert.match(serviceError,/Retry report read/);
assert.doesNotMatch(serviceError,/BLOCKED — authoritative evidence unavailable/);
console.log('authoritative read failure classification and scoped retry states passed');
