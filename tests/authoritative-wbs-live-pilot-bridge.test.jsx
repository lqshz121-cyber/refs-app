import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS,wbsLivePilotErrorGuidance,wbsReviewStatusLabel} from '../src/authoritative-wbs-live-pilot-observation.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48),scopePresentation:{entityLabel:'Test entity'}};
const render=tools=>renderToStaticMarkup(<AuthoritativeWbsLivePilotObservation config={config} tools={tools} fetcher={async()=>{throw new Error('SSR must not call WBS');}}/>);

const dashboard=render(WBS_LIVE_PILOT_SURFACE_TOOLS.dashboard);
for(const label of ['Payables','Bank transactions','AutoRec details','AutoRec banks','Journal entries'])assert.match(dashboard,new RegExp(`>${label}<`));
for(const boundary of ['Review only','not added to your books until their source and company assignment are verified'])assert.match(dashboard,new RegExp(boundary,'i'));
assert.match(dashboard,/No WBS records loaded yet/);
assert.match(dashboard,/Refresh WBS records/);
for(const liveFact of ['WBS records for finance review','Last refreshed','Records received','Test entity','WBS data connection'])assert.match(dashboard,new RegExp(liveFact));

const payables=render(WBS_LIVE_PILOT_SURFACE_TOOLS.payables);
assert.match(payables,/Record type:<\/b> Payables/);
for(const boundary of ['Record retained','Source needs verification','Finance review required','Not in books','They do not create bills, journals, general-ledger activity, or posted balances'])assert.match(payables,new RegExp(boundary,'i'));
assert.match(payables,/Keep for review/);assert.match(payables,/Refresh review records/);
const source=fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8');
for(const retainedUi of ['WBS Payable records held for finance review','Company scope','View review records','View details','Waiting for verified source','GL / REPORT','Next owner'])assert.match(source,new RegExp(retainedUi));
assert.equal(wbsReviewStatusLabel('MIXED_COMPANY'),'Multiple companies');
assert.equal(wbsReviewStatusLabel('EXCEPTION_REVIEW_REQUIRED'),'Needs finance review');
assert.equal(wbsReviewStatusLabel('AUTHORIZATION_DENIED'),'Additional review access required');
assert.match(source,/row\.document_number\|\|`Source \$\{row\.source_record_id\}`/,'retained immutable evidence must expose its server-provided source record when the Provider supplied no invoice number');
assert.match(source,/row\.accounting_date\|\|'Not supplied by Provider'/,'a missing provider accounting date must be explicit rather than presented as a false zero or generic unavailable state');
assert.match(source,/refreshAuthoritativeWbsOperatorPayableExceptionRows/);
assert.match(payables,/title="Available after you have permission to keep WBS review records and at least one WBS payable record has been loaded\."/,'the disabled review button must explain what is required');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/refreshAuthoritativeWbsOperatorPayableAttestations\(\{config,fetcher\}\).*canAttest:true/s,'the existing protected retained-evidence GET must drive operator button capability');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/companyCode:scopeCompany\?requestedCompanyCode\|\|null:null,dateFrom:requestedCompanyCode\?dateFrom:null,dateTo:requestedCompanyCode\?dateTo:null/,'a date range may only be sent alongside an explicit native company scope');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/Approved WBS company code.*WBS observation date from.*WBS observation date to/s,'the authoritative UI must expose the exact Provider-native company and date scope');
assert.match(source,/useState\('2026-01-01'\).*useState\('2026-12-31'\)/s,'the approved first authoritative WBS read must default to the complete 2026 scope');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/!hasExactAttestationScope.*Company assignment is needed/s,'mixed or unresolved company results must remain visible and retainable only as finance-review evidence');
assert.match(fs.readFileSync('src/authoritative-overview.jsx','utf8'),/AuthoritativeWbsLivePilotObservation[\s\S]*showRows=\{true\}/,'the authoritative overview must expose real WBS observation rows with their finance-review boundary visible');
assert.match(wbsLivePilotErrorGuidance('ACCOUNTING_API_SERVER_ERROR'),/WBS connection is available/);
assert.match(wbsLivePilotErrorGuidance('WBS_LIVE_PILOT_PROTOCOL'),/company, date, currency, and source record/);
assert.match(wbsLivePilotErrorGuidance('WBS_LIVE_PILOT_SCOPE_INVALID'),/exact WBS company code/);
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/disabled=\{!retainPathReady\|\|capabilityState\.phase!==\'READY\'\|\|!capabilityState\.canAttest/,'operator actions must remain disabled until the protected persistence path is live');
assert.doesNotMatch(payables,/<select/);
assert.doesNotMatch(payables,/Bank transactions|AutoRec details|Journal entries/);

const bank=render(WBS_LIVE_PILOT_SURFACE_TOOLS.bank);
assert.match(bank,/Record type:<\/b> Bank transactions/);
assert.doesNotMatch(bank,/>AutoRec banks</);
assert.doesNotMatch(bank,/>Payables<|>Journal entries</);

const journal=render(WBS_LIVE_PILOT_SURFACE_TOOLS.journal);
assert.match(journal,/Record type:<\/b> Journal entries/);
assert.doesNotMatch(journal,/<select/);
assert.doesNotMatch(journal,/>Payables<|>Bank transactions</);

assert.match(source,/limit:10/);
assert.match(source,/refreshAuthoritativeWbsLivePilot/);
assert.doesNotMatch(source,/localStorage|sessionStorage|seed\.js|repo\.js|method:\s*['"](?:PUT|PATCH|DELETE)['"]|vendor_name|vendor_no|payee/);
assert.match(source,/attestAuthoritativeWbsPayableObservation/);assert.match(source,/Confirm keep for review/);assert.match(source,/attestationConfirmation\?attest\(\):setAttestationConfirmation\(true\)/);assert.match(source,/It will not create a draft or post anything/);assert.doesNotMatch(source,/globalThis\.confirm/);
assert.match(source,/const retainPathReady=true/);assert.match(source,/disabled=\{!retainPathReady\|\|capabilityState/);assert.doesNotMatch(source,/!hasExactAttestationScope\|\|attestationState/);
for(const host of ['authoritative-overview.jsx','authoritative-workspace.jsx','authoritative-bank-workspace.jsx','authoritative-journal-workspace.jsx','authoritative-wbs-transition-workspace.jsx']){
  assert.match(fs.readFileSync(`src/${host}`,'utf8'),/AuthoritativeWbsLivePilotObservation/,`${host} must use the shared read-only WBS observation`);
}
const documents=fs.readFileSync('src/authoritative-workspace.jsx','utf8');
assert.match(documents,/bill&&<AuthoritativeWbsLivePilotObservation/,'only AP may map the provider payables observation; AR must not fabricate a receivables view');

console.log('authoritative WBS live-pilot bridge: closed per-surface GET-only observation contract passed');
