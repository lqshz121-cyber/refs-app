import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAmortizationWorkspace} from '../src/authoritative-amortization-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeAmortizationWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
for(const token of ['Amortization Center','REVIEW REQUIRED','RETAINED SOURCE EVIDENCE','WHOLE-MONTH COVERAGE','HUMAN DRAFT REQUIRED','NO AUTO POST','Loading authoritative prepaid coverage evidence'])assert.match(markup,new RegExp(token,'i'));
const source=fs.readFileSync('src/authoritative-amortization-workspace.jsx','utf8');
for(const token of ['refreshAuthoritativeAiAmortizationCoverageEvidence','refreshAuthoritativeAiAmortizationSchedules','Coverage evidence alone never creates a journal','No browser-stored, substitute, or demonstration evidence is shown','NO REVIEW OR POST'])assert.match(source,new RegExp(token,'i'));
assert.doesNotMatch(source,/[^\x00-\x7F]/,'authoritative amortization workspace copy must remain English-only');
assert.doesNotMatch(source,/localStorage|seed\.js|repo\.js|legacy-demo-app|module-amortization-accrual/i);
console.log('authoritative amortization workspace: server-backed coverage and proposal evidence only');
