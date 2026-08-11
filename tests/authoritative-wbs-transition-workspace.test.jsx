import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeWbsTransitionWorkspace} from '../src/authoritative-wbs-transition-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeWbsTransitionWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not verify a contract');}}/>);
assert.match(markup,/WBS AutoRec transition evidence/);assert.match(markup,/EVIDENCE ONLY/);assert.match(markup,/Signed provider contract JSON/);assert.match(markup,/Verify signed contract evidence/);assert.match(markup,/BLOCKED — signed provider evidence required/);assert.match(markup,/cannot read WBS directly, create a Draft, reserve or release funds, approve, post, reverse, or write to WBS/);
assert.doesNotMatch(markup,/localStorage|seed\.js|demo|Create Draft|Approve|Post journal/);
const source=fs.readFileSync('src/authoritative-wbs-transition-workspace.jsx','utf8');
assert.match(source,/verifyAuthoritativeWbsTransitionContract/);assert.match(source,/no-action guards/);assert.doesNotMatch(source,/legacy-demo-app|\.\/seed|\.\/repo|localStorage/);
console.log('authoritative WBS transition workspace: signed evidence only, no authority actions');
