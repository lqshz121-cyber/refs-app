import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AuthoritativeFixedAssetsWorkspace,localAccountingDate,canCreateAssetAcquisition} from '../src/authoritative-fixed-assets-workspace.jsx';
const html=renderToStaticMarkup(<AuthoritativeFixedAssetsWorkspace config={{entityId:'10000000-1111-4111-8111-100000000000',scopePresentation:{entityLabel:'Example company'}}}/>);
assert.match(html,/Fixed assets/);assert.match(html,/As of date/);assert.match(html,/Example company/);assert.match(html,/Loading assets/);
const source=fs.readFileSync('src/authoritative-fixed-assets-workspace.jsx','utf8');assert.doesNotMatch(source,/localStorage|localAssetSubledger|parseFloat|Number\(/);assert.match(source,/active=false/);assert.match(source,/current.data.next_cursor/);assert.match(source,/aria-label="Asset register"/);
console.log('Asset workspace SSR and authority boundaries passed');
const makerConfig={tenantId:'10000000-1111-4111-8111-100000000000',entityId:'20000000-1111-4111-8111-100000000000'},makerAccess={status:'READY',row:{tenant_id:makerConfig.tenantId,entity_id:makerConfig.entityId,session_refresh_required:false,permissions:['FIXED_ASSET.REGISTER.VIEW','GL.JE.CREATE','GL.JE.VIEW']}};
assert.equal(canCreateAssetAcquisition(makerConfig,makerAccess),true);
for(const state of [null,{...makerAccess,status:'LOADING'},{...makerAccess,row:{...makerAccess.row,entity_id:'other'}},{...makerAccess,row:{...makerAccess.row,tenant_id:'other'}},{...makerAccess,row:{...makerAccess.row,session_refresh_required:true}},{...makerAccess,row:{...makerAccess.row,permissions:['FIXED_ASSET.REGISTER.VIEW']}}])assert.equal(canCreateAssetAcquisition(makerConfig,state),false);

assert.equal(localAccountingDate({getFullYear:()=>2026,getMonth:()=>8,getDate:()=>9}),'2026-09-09');

const denied=renderToStaticMarkup(<AuthoritativeFixedAssetsWorkspace config={{entityId:'10000000-1111-4111-8111-100000000000'}} accessState={{status:'ERROR',message:'Read failed'}}/>);assert.match(denied,/Retry company access/);assert.doesNotMatch(denied,/Loading assets/);
