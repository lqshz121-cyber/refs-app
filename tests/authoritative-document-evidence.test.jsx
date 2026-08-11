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
  AuthoritativeDocumentWorkspace,
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
assert.match(list,/id="authoritative-document-22222222-2222-4222-8222-222222222222"/);

const workspaceMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[bill]} adjustments={[adjustment]} view={{query:'Evidence',status:'ALL',from:'2026-08-01',through:'2026-08-31',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(workspaceMarkup,/Payables presentation filters/);
assert.match(workspaceMarkup,/EXPENSES \/ ACCOUNTS PAYABLE/);
assert.match(workspaceMarkup,/Review authenticated API list facts/);
assert.match(workspaceMarkup,/Retained bills/);
assert.match(workspaceMarkup,/Visible after filters/);
assert.match(workspaceMarkup,/READ ONLY/);
assert.match(workspaceMarkup,/Create, pay, collect, apply, refund, approve, post, reverse, print, export, and synchronize actions are unavailable/);
assert.match(workspaceMarkup,/Document and adjustment evidence/);
assert.match(workspaceMarkup,/Opening evidence replaces the list with an independent read-only page/);
assert.match(workspaceMarkup,/Query, status, date range, page, focus, and scroll are route context only/);
assert.match(workspaceMarkup,/No create, payment, collection, approval, posting, export, or synchronization/);
assert.match(workspaceMarkup,/Bill or vendor/);
assert.match(workspaceMarkup,/2026-08-01/);
assert.match(workspaceMarkup,/1 bills · 1 adjustments/);
assert.match(workspaceMarkup,/id="authoritative-adjustment-44444444-4444-4444-8444-444444444444"/);

const invoice={...bill,business_document_id:'55555555-5555-4555-8555-555555555555',inv_no:'I-100',customer_name:'Evidence Customer',inv_date:'2026-08-01'};
const arWorkspaceMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AR" documents={[invoice]} adjustments={[]} view={{query:'',status:'ALL',from:'',through:'',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(arWorkspaceMarkup,/REVENUE \/ ACCOUNTS RECEIVABLE/);
assert.match(arWorkspaceMarkup,/Receivables/);
assert.match(arWorkspaceMarkup,/Retained invoices/);
assert.match(arWorkspaceMarkup,/Invoice or customer/);

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
  assert.match(route,/AuthoritativeDocumentWorkspace/);
}
const workspace=fs.readFileSync(path.join(process.cwd(),'src','authoritative-workspace.jsx'),'utf8');
assert.doesNotMatch(workspace,/localStorage|SEED_/,'authoritative AP/AR evidence must not read browser business state');
assert.doesNotMatch(workspace,/from ['"]\.\/repo|from ['"]\.\/seed|from ['"]\.\/data/,'authoritative AP/AR presentation must not import demo business state');
assert.match(workspace,/authoritative-document-workspace stack/,'authoritative AP/AR list facts require a full-page hierarchy rather than a bare table');
assert.match(workspace,/presentation contract/,'authoritative AP/AR hierarchy must state its API-only list/detail return boundary');
assert.match(app,/authoritative-scope-bar/,'authoritative shell must display the configured entity and period scope');
assert.match(app,/restoreAuthoritativeReturnContext/,'full-page Back must restore scroll and focus only within the exact configured scope');

console.log('authoritative-document-evidence: read-only AP/AR list, detail, Back, and empty-state contracts verified');
