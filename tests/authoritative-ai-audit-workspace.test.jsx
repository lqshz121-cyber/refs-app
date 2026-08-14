import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeAiAuditWorkspace} from '../src/authoritative-ai-audit-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeAiAuditWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
for(const token of ['Review center','ACCOUNTING INSIGHTS','SOURCE VERIFIED','AUDIT TRAIL','ASSIGN A REVIEWER','NO AUTOMATIC POSTING','Loading review items'])assert.match(markup,new RegExp(token,'i'));
const source=fs.readFileSync('src/authoritative-ai-audit-workspace.jsx','utf8');
for(const token of ['refreshAuthoritativeAiWbsExceptionFindings','No substitute or browser-stored data','This screen never creates or posts entries','Assign a due date'])assert.match(source,new RegExp(token,'i'));
assert.doesNotMatch(source,/localStorage|seed\.js|module-aiaudit|<form|onSubmit|method=['"]POST/i);
console.log('authoritative AI Audit workspace: server-backed immutable finding reader only');
