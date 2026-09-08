import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AuthoritativeFixedAssetsWorkspace,localAccountingDate,canCreateAssetAcquisition} from '../src/authoritative-fixed-assets-workspace.jsx';
import {canResumeFixedAssetAcquisitionJournal,resolveFixedAssetAcquisitionJournalScope} from '../src/fixed-asset-acquisition-workflow.js';
const html=renderToStaticMarkup(<AuthoritativeFixedAssetsWorkspace config={{entityId:'10000000-1111-4111-8111-100000000000',scopePresentation:{entityLabel:'Example company'}}}/>);
assert.match(html,/Fixed assets/);assert.match(html,/As of date/);assert.match(html,/Example company/);assert.match(html,/Loading assets/);
const source=fs.readFileSync('src/authoritative-fixed-assets-workspace.jsx','utf8');assert.doesNotMatch(source,/localStorage|localAssetSubledger|parseFloat|Number\(/);assert.match(source,/active=false/);assert.match(source,/current.data.next_cursor/);assert.match(source,/aria-label="Asset register"/);
const acquisitionSource=fs.readFileSync('src/authoritative-asset-acquisition.jsx','utf8'),appSource=fs.readFileSync('src/authoritative-app.jsx','utf8');
assert.match(acquisitionSource,/onOpenJournalWorkflow\(saved,options\.period\.period_id\)/,'the acquisition bridge must retain the authoritative source period');
assert.match(appSource,/periodId\|\|receipt\?\.period_id/,'retained pending journals may carry the same authoritative period on their row');
assert.match(appSource,/readAuthoritativeJournalEntryDetail\(\{config:targetConfig,journalEntryId:receipt\.journal_entry_id,fetcher:boundFetcher\}\)/,'the asset bridge must re-read the saved Draft in its source period');
assert.match(appSource,/applyScope\(target\);[\s\S]*setRoute\('journals'\);setWorkflowJournalId\(receipt\.journal_entry_id\)/,'the complete Journal workflow must switch to the source period before it opens');
assert.match(appSource,/onOpenJournalWorkflow=\{openAssetJournalWorkflow\}/,'the fixed-asset workspace must use the period-aware bridge');
const current={entityId:'20000000-1111-4111-8111-100000000000',periodId:'30000000-1111-4111-8111-100000000000'},sourcePeriod='40000000-1111-4111-8111-100000000000',sourceScope={entity_id:current.entityId,period_id:sourcePeriod},foreignScope={entity_id:'50000000-1111-4111-8111-100000000000',period_id:sourcePeriod};
assert.equal(resolveFixedAssetAcquisitionJournalScope(current,[foreignScope,sourceScope],sourcePeriod),sourceScope,'a source-period journal must resolve inside the current company even when the page period differs');
assert.equal(resolveFixedAssetAcquisitionJournalScope(current,[foreignScope],sourcePeriod),null,'a matching period in another company must not be selected');
for(const status of ['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED'])assert.equal(canResumeFixedAssetAcquisitionJournal(status),true,`${status} must remain resumable`);
for(const status of ['POSTED','REJECTED','VOID',null])assert.equal(canResumeFixedAssetAcquisitionJournal(status),false,`${status} must not enter the pending workflow`);
console.log('Asset workspace SSR and authority boundaries passed');
const makerConfig={tenantId:'10000000-1111-4111-8111-100000000000',entityId:'20000000-1111-4111-8111-100000000000'},makerAccess={status:'READY',row:{tenant_id:makerConfig.tenantId,entity_id:makerConfig.entityId,session_refresh_required:false,permissions:['FIXED_ASSET.REGISTER.VIEW','GL.JE.CREATE','GL.JE.VIEW']}};
assert.equal(canCreateAssetAcquisition(makerConfig,makerAccess),true);
for(const state of [null,{...makerAccess,status:'LOADING'},{...makerAccess,row:{...makerAccess.row,entity_id:'other'}},{...makerAccess,row:{...makerAccess.row,tenant_id:'other'}},{...makerAccess,row:{...makerAccess.row,session_refresh_required:true}},{...makerAccess,row:{...makerAccess.row,permissions:['FIXED_ASSET.REGISTER.VIEW']}}])assert.equal(canCreateAssetAcquisition(makerConfig,state),false);

assert.equal(localAccountingDate({getFullYear:()=>2026,getMonth:()=>8,getDate:()=>9}),'2026-09-09');

const denied=renderToStaticMarkup(<AuthoritativeFixedAssetsWorkspace config={{entityId:'10000000-1111-4111-8111-100000000000'}} accessState={{status:'ERROR',message:'Read failed'}}/>);assert.match(denied,/Retry company access/);assert.doesNotMatch(denied,/Loading assets/);
