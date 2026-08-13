import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS} from '../src/authoritative-wbs-live-pilot-observation.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const render=tools=>renderToStaticMarkup(<AuthoritativeWbsLivePilotObservation config={config} tools={tools} fetcher={async()=>{throw new Error('SSR must not call WBS');}}/>);

const dashboard=render(WBS_LIVE_PILOT_SURFACE_TOOLS.dashboard);
for(const label of ['Payables','Bank transactions','AutoRec details','AutoRec banks','Journal entries'])assert.match(dashboard,new RegExp(`>${label}<`));
for(const boundary of ['UNSIGNED PILOT','GET ONLY','NOT ADMITTED','NOT POSTABLE','excluded from every accounting total','posting workflow'])assert.match(dashboard,new RegExp(boundary,'i'));
assert.match(dashboard,/No WBS observation loaded/);
assert.match(dashboard,/Load WBS observation \(GET only\)/);

const payables=render(WBS_LIVE_PILOT_SURFACE_TOOLS.payables);
assert.match(payables,/WBS read-only view:<\/b> Payables/);
for(const boundary of ['OPERATOR ATTESTED','UNSIGNED','EXCEPTION REVIEW REQUIRED','NOT POSTED','outside Raw, Staging, AP Bills, Journals, GL, and Posted totals'])assert.match(payables,new RegExp(boundary,'i'));
assert.match(payables,/Retain as exception evidence/);assert.match(payables,/Refresh retained evidence/);
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/refreshAuthoritativeWbsOperatorPayableAttestations\(\{config,fetcher\}\).*canAttest:true/s,'the existing protected retained-evidence GET must drive operator button capability');
assert.match(fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8'),/disabled=\{capabilityState\.phase!==\'READY\'\|\|!capabilityState\.canAttest/,'operator actions must remain disabled until the protected server read succeeds');
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

const source=fs.readFileSync('src/authoritative-wbs-live-pilot-observation.jsx','utf8');
assert.match(source,/limit:10/);
assert.match(source,/refreshAuthoritativeWbsLivePilot/);
assert.doesNotMatch(source,/localStorage|sessionStorage|seed\.js|repo\.js|method:\s*['"](?:PUT|PATCH|DELETE)['"]|vendor_name|vendor_no|payee/);
assert.match(source,/attestAuthoritativeWbsPayableObservation/);assert.match(source,/globalThis\.confirm/);assert.match(source,/It will not create a Draft or post anything/);
for(const host of ['authoritative-overview.jsx','authoritative-workspace.jsx','authoritative-bank-workspace.jsx','authoritative-journal-workspace.jsx','authoritative-wbs-transition-workspace.jsx']){
  assert.match(fs.readFileSync(`src/${host}`,'utf8'),/AuthoritativeWbsLivePilotObservation/,`${host} must use the shared read-only WBS observation`);
}
const documents=fs.readFileSync('src/authoritative-workspace.jsx','utf8');
assert.match(documents,/bill&&<AuthoritativeWbsLivePilotObservation/,'only AP may map the provider payables observation; AR must not fabricate a receivables view');

console.log('authoritative WBS live-pilot bridge: closed per-surface GET-only observation contract passed');
