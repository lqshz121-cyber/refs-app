import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeReadFailure,authoritativeReadFailurePhase} from '../src/authoritative-read-state.jsx';

for(const code of ['AUTHENTICATION_REQUIRED','AUTHORIZATION_DENIED','ACCOUNTING_API_SCOPE_INVALID','ACCOUNTING_API_PROTOCOL','CONFIGURATION_REQUIRED'])assert.equal(authoritativeReadFailurePhase({code}),'BLOCKED',`${code} must fail closed as an authoritative-read boundary`);
for(const code of ['ACCOUNTING_API_UNREACHABLE','ACCOUNTING_API_SERVER_ERROR','HTTP_503',undefined])assert.equal(authoritativeReadFailurePhase({code}),'ERROR',`${code||'missing code'} must remain an ordinary retriable service error`);

const blocked=renderToStaticMarkup(<AuthoritativeReadFailure state={{phase:'BLOCKED',error:{code:'AUTHORIZATION_DENIED',message:'Current entity is not admitted.'}}} onRetry={()=>{}}/>);
assert.match(blocked,/Access needed/);
assert.match(blocked,/Current entity is not admitted\./);
assert.match(blocked,/Ask your administrator to confirm your access to this company and period/);
assert.match(blocked,/Try again/);
assert.doesNotMatch(blocked,/AUTHORIZATION_DENIED/);

const serviceError=renderToStaticMarkup(<AuthoritativeReadFailure state={{phase:'ERROR',error:{code:'ACCOUNTING_API_UNREACHABLE',message:'Gateway unavailable.'}}} onRetry={()=>{}}/>);
assert.match(serviceError,/Unable to load this information/);
assert.match(serviceError,/Gateway unavailable\./);
assert.match(serviceError,/Try again/);
assert.doesNotMatch(serviceError,/ACCOUNTING_API_UNREACHABLE/);
assert.doesNotMatch(serviceError,/Access needed/);
console.log('authoritative read failure classification and scoped retry states passed');
