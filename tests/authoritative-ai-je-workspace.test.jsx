import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAiJeWorkspace} from '../src/authoritative-ai-je-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeAiJeWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
for(const token of ['AI JE Workbench','HUMAN-CONTROLLED AI DRAFT','DRAFT ONLY','MANUAL DRAFT ONLY','NO SUBMIT','NO REVIEW','NO APPROVE','NO POST','WBS Payable journal proposals','HUMAN DECISION ONLY','Refreshing'])assert.match(markup,new RegExp(token,'i'));
assert.doesNotMatch(markup,/class="report-shelf" aria-label="AI Draft authority boundary"/,'AI Draft authority must use the compact shared boundary line rather than a six-chip shelf');
const source=fs.readFileSync('src/authoritative-ai-je-workspace.jsx','utf8');
for(const token of ['refreshAuthoritativeAiAmortizationSchedules','aiAmortizationDraftIdempotencyKey','createAuthoritativeAiAmortizationDraft','refreshAuthoritativeAiWbsPayableDraftProposals','reviewAuthoritativeAiWbsPayableDraftProposal','Select immutable schedule line','eligible_source_attachment_ids','Eligible clean attachments','Maker reason','Continue in Journal entries','No browser or demonstration proposal is substituted','No local, cached, or demonstration proposal is substituted','Record decision only','NO JOURNAL EFFECT'])assert.match(source,new RegExp(token,'i'));
assert.doesNotMatch(source,/Math\.random|Date\.now|randomUUID|localStorage|repo\.js|seed\.js|module-ai-je-workbench|newJEFromRule/i);
const testMarkup=renderToStaticMarkup(<AuthoritativeAiJeWorkspace config={{...config,deploymentEnvironment:'staging',controlledTestAiWorkflowMode:'ENABLED'}} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);for(const token of ['Run WBS TEST_ONLY AI flow','UNSIGNED TEST ONLY','browser receives no AI.TEST.WORKFLOW grant'])assert.match(testMarkup,new RegExp(token,'i'));
assert.doesNotMatch(source,/[^\x00-\x7F]/,'authoritative AI JE-visible workspace copy must remain English-only');
console.log('authoritative AI JE workspace: immutable proposal line to stable-idempotency Draft only');
