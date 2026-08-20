import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAmortizationWorkspace} from '../src/authoritative-amortization-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'22222222-2222-4222-8222-222222222222',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeAmortizationWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
for(const token of ['Amortization Center','SIGNED SOURCE','INDEPENDENT REVIEW','DRAFT ONLY','STANDARD POST','NO AUTO POST','Back','Loading amortization readiness','Loading prepaid rollforward'])assert.match(markup,new RegExp(token,'i'));
assert.match(markup,/authoritative-control-requirements/);assert.match(markup,/Control requirements/);assert.doesNotMatch(markup,/Every ID, source version, hash/);
const source=fs.readFileSync('src/authoritative-amortization-workspace.jsx','utf8');
for(const token of ['refreshAuthoritativeInsurancePrepaidAmortization','reviewAuthoritativeInsurancePrepaidAmortization','createAuthoritativeInsuranceAmortizationDraft','refreshAuthoritativePrepaidRollforward','PROPOSED rows are not reviewed schedules','Retain independent review','Create monthly AUTO Draft','never submits, reviews, approves, or posts'])assert.match(source,new RegExp(token,'i'));
assert.doesNotMatch(source,/localStorage|seed\.js|createAmortizationScheduleFromInsurance|newJEFromRule|Number\(|parseFloat|parseInt/i);
assert.doesNotMatch(source,/[^\x00-\x7F]/,'authoritative amortization workspace copy must remain English-only');
console.log('authoritative amortization workspace: signed evidence, independent review, Draft-only, no auto-post');
