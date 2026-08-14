import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS,wbsLivePilotErrorGuidance} from '../src/authoritative-wbs-live-pilot-observation.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48),scopePresentation:{entityLabel:'Test entity'}};
const render=tools=>renderToStaticMarkup(<AuthoritativeWbsLivePilotObservation config={config} tools={tools} fetcher={async()=>{throw new Error('SSR must not call WBS');}}/>);

const dashboard=render(WBS_LIVE_PILOT_SURFACE_TOOLS.dashboard);
for(const label of ['Payables','Bank transactions','AutoRec details','AutoRec banks','Journal entries'])assert.match(dashboard,new RegExp(`>${label}<`));
for(const boundary of ['READ ONLY','No demo or browser-stored data'])assert.match(dashboard,new RegExp(boundary,'i'));
assert.match(dashboard,/Live connection not checked/);
assert.match(dashboard,/Refresh live WBS data/);
for(const liveFact of ['Live WBS connection status','Last successful API read','Record count','Test entity','Production WBS API'])assert.match(dashboard,new RegExp(liveFact));

const payables=render(WBS_LIVE_PILOT_SURFACE_TOOLS.payables);
assert.match(payables,/WBS read-only view:<\/b> Payables/);
for(const boundary of ['OPERATOR ATTESTED','UNSIGNED','EXCEPTION REVIEW REQUIRED','NOT POSTED','outside Raw, Staging, AP Bills, Journals, GL, and Posted totals'])assert.match(payables,new RegExp(boundary,'i'));
assert.match(payables,/Retain as exception evidence/);assert.match(payables,/Refresh retained evidence/);
const source=fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8');
for(const retainedUi of ['Real retained WBS Payable exception rows','Company scope status','View retained rows','View details','AWAITING SIGNED REDELIVERY','GL / REPORT','Next owner'])assert.match(source,new RegExp(retainedUi));
assert.match(source,/refreshAuthoritativeWbsOperatorPayableExceptionRows/);
assert.match(payables,/title="Unavailable until authenticated exception-evidence access and a live WBS Payables observation with at least one row are available"/,'the disabled exception-retain button must explain its unavailable state');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/refreshAuthoritativeWbsOperatorPayableAttestations\(\{config,fetcher\}\).*canAttest:true/s,'the existing protected retained-evidence GET must drive operator button capability');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/requestedCompanyCode\?dateFrom:null,dateTo:requestedCompanyCode\?dateTo:null/,'the browser may read an unscoped diagnostic sample, but must send dates only with one explicit Provider-native company scope');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/Approved WBS company code.*WBS observation date from.*WBS observation date to/s,'the authoritative UI must expose the exact Provider-native company and date scope');
assert.match(source,/useState\('2026-01-01'\).*useState\('2026-06-30'\)/s,'the approved first authoritative WBS read must default to the 2026 first-half scope');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/!hasExactAttestationScope.*UNASSIGNED COMPANY - exception intake available/s,'mixed or unresolved company results must remain visible and retainable only as exception evidence');
assert.match(wbsLivePilotErrorGuidance('ACCOUNTING_API_SERVER_ERROR'),/retry after the production WBS service is available/);
assert.match(wbsLivePilotErrorGuidance('WBS_LIVE_PILOT_PROTOCOL'),/immutable company, accounting-date, currency, and source-record evidence/);
assert.match(wbsLivePilotErrorGuidance('WBS_LIVE_PILOT_SCOPE_INVALID'),/exact Provider company code/);
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/disabled=\{!retainPathReady\|\|capabilityState\.phase!==\'READY\'\|\|!capabilityState\.canAttest/,'operator actions must remain disabled until the protected persistence path is live');
assert.doesNotMatch(payables,/<select/);
assert.doesNotMatch(payables,/Bank transactions|AutoRec details|Journal entries/);

const bank=render(WBS_LIVE_PILOT_SURFACE_TOOLS.bank);
assert.match(bank,/WBS read-only view:<\/b> Bank transactions/);
assert.doesNotMatch(bank,/>AutoRec banks</);
assert.doesNotMatch(bank,/>Payables<|>Journal entries</);

const journal=render(WBS_LIVE_PILOT_SURFACE_TOOLS.journal);
assert.match(journal,/WBS read-only view:<\/b> Journal entries/);
assert.doesNotMatch(journal,/<select/);
assert.doesNotMatch(journal,/>Payables<|>Bank transactions</);

assert.match(source,/limit:10/);
assert.match(source,/refreshAuthoritativeWbsLivePilot/);
assert.doesNotMatch(source,/localStorage|sessionStorage|seed\.js|repo\.js|method:\s*['"](?:PUT|PATCH|DELETE)['"]|vendor_name|vendor_no|payee/);
assert.match(source,/attestAuthoritativeWbsPayableObservation/);assert.match(source,/Confirm exception retain/);assert.match(source,/attestationConfirmation\?attest\(\):setAttestationConfirmation\(true\)/);assert.match(source,/It will not create a Draft or post anything/);assert.doesNotMatch(source,/globalThis\.confirm/);
assert.match(source,/const retainPathReady=true/);assert.match(source,/disabled=\{!retainPathReady\|\|capabilityState/);assert.doesNotMatch(source,/!hasExactAttestationScope\|\|attestationState/);
for(const host of ['authoritative-overview.jsx','authoritative-workspace.jsx','authoritative-bank-workspace.jsx','authoritative-journal-workspace.jsx','authoritative-wbs-transition-workspace.jsx']){
  assert.match(fs.readFileSync(`src/${host}`,'utf8'),/AuthoritativeWbsLivePilotObservation/,`${host} must use the shared read-only WBS observation`);
}
const documents=fs.readFileSync('src/authoritative-workspace.jsx','utf8');
assert.match(documents,/bill&&<AuthoritativeWbsLivePilotObservation/,'only AP may map the provider payables observation; AR must not fabricate a receivables view');

console.log('authoritative WBS live-pilot bridge: closed per-surface GET-only observation contract passed');
