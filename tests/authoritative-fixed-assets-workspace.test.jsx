import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AuthoritativeFixedAssetsWorkspace,localAccountingDate} from '../src/authoritative-fixed-assets-workspace.jsx';
const html=renderToStaticMarkup(<AuthoritativeFixedAssetsWorkspace config={{entityId:'10000000-1111-4111-8111-100000000000',scopePresentation:{entityLabel:'Example company'}}}/>);
assert.match(html,/Fixed assets/);assert.match(html,/As of date/);assert.match(html,/Example company/);assert.match(html,/Loading assets/);
const source=fs.readFileSync('src/authoritative-fixed-assets-workspace.jsx','utf8');assert.doesNotMatch(source,/localStorage|localAssetSubledger|parseFloat|Number\(/);assert.match(source,/active=false/);assert.match(source,/current.data.next_cursor/);assert.match(source,/aria-label="Asset register"/);
console.log('Asset workspace SSR and authority boundaries passed');

assert.equal(localAccountingDate({getFullYear:()=>2026,getMonth:()=>8,getDate:()=>9}),'2026-09-09');

const denied=renderToStaticMarkup(<AuthoritativeFixedAssetsWorkspace config={{entityId:'10000000-1111-4111-8111-100000000000'}} accessState={{status:'ERROR',message:'Read failed'}}/>);assert.match(denied,/Retry company access/);assert.doesNotMatch(denied,/Loading assets/);
