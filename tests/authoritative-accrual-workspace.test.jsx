import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAccrualWorkspace} from '../src/authoritative-accrual-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeAccrualWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
for(const token of ['Accrual Center','REVIEW REQUIRED','SIGNED SOURCE TRACE','DETERMINISTIC RULE','NO DRAFT OR POST','Loading authoritative accrual analysis'])assert.match(markup,new RegExp(token,'i'));
const source=fs.readFileSync('src/authoritative-accrual-workspace.jsx','utf8');
for(const token of ['refreshAuthoritativeAiAccrualCandidates','three exact consecutive closed-period source records','No browser-stored, substitute, or demonstration candidates are shown','owner, due date, accrual basis, account mapping, member trace, and reversing-entry decision','NO DRAFT OR POST'])assert.match(source,new RegExp(token,'i'));
assert.doesNotMatch(source,/[^\x00-\x7F]/,'authoritative accrual workspace copy must remain English-only');
assert.doesNotMatch(source,/localStorage|seed\.js|repo\.js|legacy-demo-app|module-amortization-accrual/i);
console.log('authoritative accrual workspace: server-backed, deterministic, review-only');
