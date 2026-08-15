import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAiAuditWorkspace} from '../src/authoritative-ai-audit-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeAiAuditWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
for(const token of ['AI Audit Center','SERVER MATERIALIZED','IMMUTABLE TRACE','HUMAN ASSIGNMENT REQUIRED','NO DRAFT OR POST','Loading persisted AI findings'])assert.match(markup,new RegExp(token,'i'));
const source=fs.readFileSync('src/authoritative-ai-audit-workspace.jsx','utf8');
for(const token of ['assignAuthoritativeAiFindingAction','refreshAuthoritativeAiFindingAssignmentCandidates','refreshAuthoritativeAiFindingActions','refreshAuthoritativeAiAccrualCandidates','No substitute, browser-stored, or demonstration evidence','Controller analysis summary','Recurring accrual candidates','Only exact three-period recurring-obligation gaps appear here','Controller action queue','Assign finding owner','Resolved actions are excluded and cannot be reopened here','assignableCandidates','Current assignment revision','No source, Draft, review, approval, or posting was changed','AI controller explanation','Generate explanation','Prepaid coverage gaps','Retain coverage evidence','No amortization proposal or journal action was created','Coverage evidence to amortization proposal','Prepare amortization proposal','No Draft, review, approval, or posting was created','Exact duplicate payable risk','Unmatched bank payment risk','Construction cost dimension risk','Construction loan reference risk','Prepaid / amortization proposals','Draft / review / approve / post: disabled','Due date requires human assignment'])assert.match(source,new RegExp(token,'i'));
assert.doesNotMatch(source,/[^\x00-\x7F]/,'authoritative AI-visible workspace copy must remain English-only');
assert.doesNotMatch(source,/localStorage|seed\.js|module-aiaudit|<form|onSubmit/i);
console.log('authoritative AI Audit workspace: server-backed evidence and explicit no-action analysis only');
