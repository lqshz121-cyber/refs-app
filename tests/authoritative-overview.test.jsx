import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthoritativeOverview } from '../src/authoritative-overview.jsx';

const markup = renderToStaticMarkup(<AuthoritativeOverview
  counts={{ bills: 2, invoices: 3, adjustments: 4, journals: 5 }}
  onNavigate={() => {}}
/>);

assert.match(markup, /Accounting control overview/);
assert.match(markup, /API-backed/);
assert.match(markup, /Bills &amp; expenses/);
assert.match(markup, /Invoices &amp; receipts/);
assert.match(markup, /retained evidence/);
assert.doesNotMatch(markup, /localStorage|seed\.js|Demo/);
console.log('authoritative overview: API-backed page header and workspace links render without local demo state');
