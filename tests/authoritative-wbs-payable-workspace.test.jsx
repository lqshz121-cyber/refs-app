import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeWbsPayableWorkspace} from '../src/authoritative-wbs-payable-workspace.jsx';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const markup=renderToStaticMarkup(<AuthoritativeWbsPayableWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(markup,/Reviewed WBS Payables/);assert.match(markup,/Loading reviewed WBS Payables/);
const source=fs.readFileSync('src/authoritative-wbs-payable-workspace.jsx','utf8');
for(const token of ['refreshAuthoritativeWbsPayableReviewEvidence','createAuthoritativeWbsPayableApDraft','Create AP Bill Draft','maker reason','Nothing was submitted, reviewed, approved, or posted'])assert.match(source,new RegExp(token,'i'));
assert.doesNotMatch(source,/localStorage|seed\.js|Submit Bill|Approve Bill|Post Journal/);
console.log('authoritative WBS Payable workspace: reviewed evidence to Draft only');
