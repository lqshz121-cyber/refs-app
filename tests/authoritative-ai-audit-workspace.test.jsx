import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAiAuditWorkspace} from '../src/authoritative-ai-audit-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeAiAuditWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
for(const token of ['Accounting review insights','CURRENT RECORDS','AUDIT TRAIL','OWNER NEEDED','NO AUTOMATIC POSTING','Loading persisted AI findings'])assert.match(markup,new RegExp(token,'i'));
const source=fs.readFileSync('src/authoritative-ai-audit-workspace.jsx','utf8');
for(const token of ['explainAuthoritativeAiAccountingAnalysis','refreshAuthoritativeAiAccountingAnalysisSummary','refreshAuthoritativeAiWbsExceptionFindings','refreshAuthoritativeAiPrepaidCoverageFindings','refreshAuthoritativeAiDuplicatePayableFindings','refreshAuthoritativeAiUnmatchedBankPaymentFindings','refreshAuthoritativeAiCostDimensionFindings','refreshAuthoritativeAiLoanReferenceFindings','refreshAuthoritativeAiAmortizationSchedules','No replacement data is shown','Controller analysis summary','AI controller explanation','Generate explanation','Prepaid coverage gaps','Exact duplicate payable risk','Unmatched bank payment risk','Construction cost dimension risk','Construction loan reference risk','Prepaid / amortization proposals','Draft / review / approve / post: disabled','Due date requires human assignment'])assert.match(source,new RegExp(token,'i'));
assert.doesNotMatch(source,/[^\x00-\x7F]/,'authoritative AI-visible workspace copy must remain English-only');
assert.doesNotMatch(source,/localStorage|seed\.js|module-aiaudit|<form|onSubmit/i);
console.log('authoritative AI Audit workspace: server-backed evidence and explicit no-action analysis only');
