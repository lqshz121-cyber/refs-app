import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AuthoritativeAdjustmentDetail,
  AuthoritativeAdjustmentSummary,
  AuthoritativeDocumentDetail,
  AuthoritativeDocumentTable,
} from '../src/authoritative-workspace.jsx';

const entityId='11111111-1111-4111-8111-111111111111';
const periodId='33333333-3333-4333-8333-333333333333';
const bill={business_document_id:'22222222-2222-4222-8222-222222222222',bill_no:'B-100',vendor_name:'Evidence Vendor',bill_date:'2026-08-01',due_date:'2026-08-31',amount:125.25,open_balance:25.25,currency:'USD',status:'PARTIALLY_PAID',revision:3,period_id:periodId,account_code:'610000',je_number:null,description:'Retained bill evidence'};
const adjustment={business_adjustment_id:'44444444-4444-4444-8444-444444444444',adjustment_kind:'AP_VENDOR_CREDIT',business_document_id:null,source_adjustment_id:null,amount:10,currency:'USD',accounting_date:'2026-08-02',period_id:periodId,reason:'Retained credit evidence',status:'DRAFT',version:2,journal_entry_id:null,journal_status:null,journal_revision:null,created_at:'2026-08-02T00:00:00.000Z'};

const list=renderToStaticMarkup(<AuthoritativeDocumentTable title="AP bills" documents={[bill]} kind="AP" onOpen={()=>{}}/>);
assert.match(list,/Authoritative API rows only/);
assert.match(list,/Open evidence/);
assert.match(list,/Open balance/);
assert.match(list,/Evidence Vendor/);

const detail=renderToStaticMarkup(<AuthoritativeDocumentDetail document={bill} kind="AP" entityId={entityId} onBack={()=>{}}/>);
assert.match(detail,/Back to AP bills/);
assert.match(detail,/Entity 11111111-1111-4111-8111-111111111111/);
assert.match(detail,/authoritative list revision 3/);
assert.match(detail,/cannot create, edit, approve, pay, allocate, post, print, export, or synchronize/);
assert.doesNotMatch(detail,/<input|<select|>Approve<|>Post<|>Pay</i);

const adjustmentList=renderToStaticMarkup(<AuthoritativeAdjustmentSummary title="AP adjustments" adjustments={[adjustment]} onOpen={()=>{}}/>);
assert.match(adjustmentList,/AP_VENDOR_CREDIT/);
assert.match(adjustmentList,/Open evidence/);
const adjustmentDetail=renderToStaticMarkup(<AuthoritativeAdjustmentDetail adjustment={adjustment} side="AP" entityId={entityId} onBack={()=>{}}/>);
assert.match(adjustmentDetail,/Back to AP adjustments/);
assert.match(adjustmentDetail,/authoritative adjustment revision 2/);
assert.match(adjustmentDetail,/cannot create, edit, apply, refund, approve, post, reverse, print, export, or synchronize/);

const empty=renderToStaticMarkup(<AuthoritativeDocumentTable title="AR invoices" documents={[]} kind="AR"/>);
assert.match(empty,/not evidence of a zero balance/);
assert.doesNotMatch(empty,/<table/);

const app=fs.readFileSync(path.join(process.cwd(),'src','authoritative-app.jsx'),'utf8');
const apRoute=app.slice(app.indexOf("route === 'payables'"),app.indexOf("route === 'receivables'"));
const arRoute=app.slice(app.indexOf("route === 'receivables'"),app.indexOf("route === 'bank'"));
for(const route of [apRoute,arRoute]){
  assert.doesNotMatch(route,/AuthoritativeWorkflow(?:Adjustment)?Table|onWorkflow=\{workflow\}/,'AP/AR evidence routes must not expose journal transition controls');
  assert.match(route,/AuthoritativeDocumentDetail/);
  assert.match(route,/AuthoritativeAdjustmentDetail/);
}
const workspace=fs.readFileSync(path.join(process.cwd(),'src','authoritative-workspace.jsx'),'utf8');
assert.doesNotMatch(workspace,/localStorage|SEED_/,'authoritative AP/AR evidence must not read browser business state');

console.log('authoritative-document-evidence: read-only AP/AR list, detail, Back, and empty-state contracts verified');
