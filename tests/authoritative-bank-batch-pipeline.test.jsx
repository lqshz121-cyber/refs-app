import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthoritativeBankBatchPipelineWorkspace } from '../src/authoritative-bank-batch-pipeline-workspace.jsx';

const markup=renderToStaticMarkup(<AuthoritativeBankBatchPipelineWorkspace config={{entityId:'entity-isolated',periodId:'period-isolated',scopePresentation:{entityLabel:'REFS US Staging',periodLabel:'August 2026'}}} fetcher={async()=>({})} environment={{}}/>);
for(const text of ['Bank Batch Pipeline','Scoped bank source evidence','Exact Match review','Statement reconciliation','Immutable sign-off history','Bank transactions','Reconcile'])assert.match(markup,new RegExp(text));
assert.match(markup,/REFS US Staging/,'the composed workspaces must retain the authoritative entity display label');
assert.doesNotMatch(markup,/>Configured entity</,'a readable entity label must not regress to a generic fallback in the batch entry');
const source=fs.readFileSync('src/authoritative-bank-batch-pipeline-workspace.jsx','utf8');
assert.match(source,/AuthoritativeBankWorkspace/);
assert.match(source,/AuthoritativeReconciliationWorkspace/);
assert.doesNotMatch(source,/seed\.js|legacy-demo-app|localStorage|createAuthoritativeBankPaymentMatch|transitionAuthoritativeReconciliation/,
  'the batch entry must compose API-owned workspaces, never a browser-side batch, store, or command implementation');
console.log('authoritative-bank-batch-pipeline: composes scoped API evidence without browser batch state or automatic posting');
