import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthoritativeOverview } from '../src/authoritative-overview.jsx';

const ready = renderToStaticMarkup(<AuthoritativeOverview counts={{ bills: 2, invoices: 3, adjustments: 4, journals: 5 }} onNavigate={() => {}}/>);
assert.match(ready, /Accounting control overview/);
assert.match(ready, /API-BACKED/);
assert.match(ready, /Live accounting evidence/);
assert.match(ready, /Bills &amp; expenses/);
assert.match(ready, /Continue with authoritative evidence/);
assert.match(ready, /Bank evidence/);
assert.match(ready, /retained evidence/);
assert.doesNotMatch(ready, /localStorage|seed\.js|Demo|Create journal entry/);

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
