import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthoritativeOverview } from '../src/authoritative-overview.jsx';

const ready = renderToStaticMarkup(<AuthoritativeOverview counts={{ bills: 2, invoices: 3, adjustments: 4, journals: 5 }} onNavigate={() => {}} scope={{entityId:'entity-1',periodId:'2026-07'}}/>);
assert.match(ready, /Accounting control overview/);
assert.match(ready, /Bills &amp; expenses/);
assert.match(ready, /Business at a glance/);
assert.match(ready, /Banking/);
assert.match(ready, /retained AP evidence/);
assert.match(ready, /entity-1/);
assert.match(ready, /2026-07/);
assert.match(ready, /Expenses &amp; Pay Bills/);
assert.match(ready, /Open journals/);
assert.doesNotMatch(ready, /localStorage|seed\.js|Create journal entry/);
assert.equal((ready.match(/class="qbo-card authoritative-overview-card"/g) || []).length, 6);
assert.equal((ready.match(/class="qbo-quicklinks"/g) || []).length, 1);
assert.match(ready, /class="qbo-home-hero"/);
assert.match(ready, /class="qb-greet-spacer"/);

const empty = renderToStaticMarkup(<AuthoritativeOverview counts={{ bills: 0, invoices: 0, adjustments: 0, journals: 0 }} onNavigate={() => {}}/>);
assert.match(empty, /No retained records were returned for this scope/);
assert.match(empty, /authoritative empty result/);

const loading = renderToStaticMarkup(<AuthoritativeOverview state="loading"/>);
assert.match(loading, /Loading authoritative accounting evidence/);
assert.match(loading, /aria-busy="true"/);

const blocked = renderToStaticMarkup(<AuthoritativeOverview state="blocked" detail="Scope denied."/>);
assert.match(blocked, /BLOCKED/);
assert.match(blocked, /Scope denied/);
assert.doesNotMatch(blocked, /localStorage|seed\.js|Demo/);
console.log('authoritative overview: API-only dashboard hierarchy and explicit ready, empty, loading, and blocked states render without demo state');
