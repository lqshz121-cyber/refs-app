import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthoritativeOverview } from '../src/authoritative-overview.jsx';

const ready = renderToStaticMarkup(<AuthoritativeOverview counts={{ bills: 2, invoices: 3, adjustments: 4, journals: 5 }} onNavigate={() => {}} scope={{entityId:'entity-1',periodId:'2026-07'}}/>);
assert.match(ready, /Financial overview/);
assert.match(ready, /Bills &amp; expenses/);
assert.match(ready, /Your books at a glance/);
assert.match(ready, /Banking/);
assert.match(ready, /Review bills and expenses/);
assert.match(ready, /entity-1/);
assert.match(ready, /2026-07/);
assert.match(ready, /Expenses &amp; Pay Bills/);
assert.match(ready, /Journal entries/);
assert.doesNotMatch(ready, /localStorage|seed\.js|Create journal entry/);
assert.equal((ready.match(/class="qbo-card authoritative-overview-card"/g) || []).length, 6);
assert.equal((ready.match(/class="qbo-quicklinks"/g) || []).length, 1);
assert.match(ready, /class="qbo-home-hero"/);
assert.match(ready, /class="qb-greet-spacer"/);

const readableScope=renderToStaticMarkup(<AuthoritativeOverview counts={{bills:0,invoices:0,adjustments:0,journals:0}} onNavigate={()=>{}} scope={{entityId:'ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId:'4e0b2744-2366-46d5-8b34-6ccf49deaabf'}} config={{scopePresentation:{entityLabel:'Configured entity',entityDetail:'ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodLabel:'2026-07',periodDetail:'Jul 1, 2026 - Jul 31, 2026'}}}/>);
assert.match(readableScope,/records available for Configured entity/);assert.match(readableScope,/2026-07/);assert.doesNotMatch(readableScope,/>[^<]*ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3[^<]*</);

const empty = renderToStaticMarkup(<AuthoritativeOverview counts={{ bills: 0, invoices: 0, adjustments: 0, journals: 0 }} onNavigate={() => {}}/>);
assert.match(empty, /No posted activity in this period yet/);
assert.match(empty, /have an authorized reviewer verify a signed source record/);
assert.doesNotMatch(empty, /INGESTION_BLOCKED|authoritative API/);

const loading = renderToStaticMarkup(<AuthoritativeOverview state="loading"/>);
assert.match(loading, /Preparing your overview/);
assert.match(loading, /aria-busy="true"/);

const blocked = renderToStaticMarkup(<AuthoritativeOverview state="blocked" detail="Scope denied."/>);
assert.match(blocked, /ACCESS NEEDED/);
assert.match(blocked, /Scope denied/);
assert.doesNotMatch(blocked, /localStorage|seed\.js|Demo/);
console.log('authoritative overview: API-only dashboard hierarchy and explicit ready, empty, loading, and blocked states render without demo state');
