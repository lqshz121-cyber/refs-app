import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAccountingAnalysisReport} from '../src/authoritative-accounting-analysis-report.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeAccountingAnalysisReport config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}} onNavigate={()=>{}}/>);
for(const token of ['Accounting Analysis Report','CONTROLLER ANALYSIS','READ ONLY','Controller review package','RETAINED REPORT','SOURCE-BOUND FINDINGS','HUMAN ACCOUNTABILITY','NO DRAFT','NO APPROVAL','NO POST','Loading retained Controller memos','Loading finding totals','Scanning retained invoice evidence','Invoice accounting classifications','Loading Controller actions','Open AI Audit Center'])assert.match(markup,new RegExp(token,'i'));
const source=fs.readFileSync('src/authoritative-accounting-analysis-report.jsx','utf8');
for(const token of ['refreshAuthoritativeAiAccountingAnalysisReports','refreshAuthoritativeAiAccountingAnalysisSummary','refreshAuthoritativeAiFindingActions','refreshAuthoritativeAiInvoiceAccountingClassifications','source_payload_hash','Capitalization is never inferred','request_hash','finding_ids','finding_hash','No browser, cached, or demonstration analysis is substituted','Empty evidence is not treated as a clean close'])assert.match(source,new RegExp(token,'i'));
assert.doesNotMatch(source,/localStorage|repo\.js|seed\.js|module-aiaudit|module-ai-je-workbench|createAuthoritative|approveAuthoritative|postAuthoritative/i);
assert.doesNotMatch(source,/[^\x00-\x7F]/,'authoritative Accounting Analysis Report copy must remain English-only');
console.log('authoritative Accounting Analysis Report: durable controller evidence and no accounting actions');
