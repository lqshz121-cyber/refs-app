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
  authoritativeLineageFor,
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
assert.match(list,/class="table-wrap authoritative-document-table" role="region" tabindex="0" aria-label="AP bills; scroll horizontally to view every column"/,'AP/AR list evidence must be reachable through a labelled keyboard-focusable horizontal scroll region');
assert.match(list,/<th scope="col">Bill<\/th>/,'data-table headers must have column semantics');

const workspaceMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[bill]} adjustments={[adjustment]} view={{query:'Evidence',status:'PARTIALLY_PAID',from:'2026-08-01',through:'2026-08-31',counterparty:'Evidence Vendor',accountCode:'610000',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(workspaceMarkup,/Payables presentation filters/);
assert.match(workspaceMarkup,/Category \(offset account\)/);
assert.match(workspaceMarkup,/Reset filters/);
assert.match(workspaceMarkup,/EXPENSES \/ ACCOUNTS PAYABLE/);
assert.match(workspaceMarkup,/Review authenticated API list facts/);
assert.match(workspaceMarkup,/Retained bills/);
assert.match(workspaceMarkup,/Visible after filters/);
assert.match(workspaceMarkup,/READ ONLY/);
assert.match(workspaceMarkup,/Document and adjustment evidence/);
assert.match(workspaceMarkup,/Filter retained API list facts, then open an independent read-only evidence page/);
assert.match(workspaceMarkup,/Query, filters, page, focus, and scroll are preserved/);
assert.match(workspaceMarkup,/No create, payment, collection, approval, posting, export, or synchronization/);
assert.match(workspaceMarkup,/Search retained references/);
assert.match(workspaceMarkup,/Payee \/ vendor/);
assert.match(workspaceMarkup,/Category \(offset account\)/);
assert.match(workspaceMarkup,/Reset filters/);
assert.match(workspaceMarkup,/Applied presentation scope: Status: PARTIALLY_PAID/);
assert.match(workspaceMarkup,/Category is derived only from the retained AP Bill offset-account field/);
assert.match(workspaceMarkup,/Delivery method is unavailable/);
assert.match(workspaceMarkup,/2026-08-01/);
assert.match(workspaceMarkup,/1 bills[\s\S]*0 adjustments/);
assert.match(workspaceMarkup,/No adjustments match these presentation filters/);
assert.match(workspaceMarkup,/class="qbo-toolgrid authoritative-document-summary"/,'AP/AR counts must use the authoritative summary-card hierarchy');
assert.match(workspaceMarkup,/class="authoritative-document-intro"/,'AP/AR list/detail boundaries must be presented as a compact evidence guide');
assert.match(workspaceMarkup,/Filter retained evidence/,'filters need a visible read-only heading rather than a bare control row');

const invoice={...bill,business_document_id:'55555555-5555-4555-8555-555555555555',inv_no:'I-100',customer_name:'Evidence Customer',inv_date:'2026-08-01'};
const arWorkspaceMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AR" documents={[invoice]} adjustments={[]} view={{query:'',status:'ALL',from:'',through:'',accountCode:'999999',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(arWorkspaceMarkup,/REVENUE \/ ACCOUNTS RECEIVABLE/);
assert.match(arWorkspaceMarkup,/Receivables/);
assert.match(arWorkspaceMarkup,/Retained invoices/);
assert.match(arWorkspaceMarkup,/Invoice, customer, account, or reference/);
assert.doesNotMatch(arWorkspaceMarkup,/Category \(offset account\)/,'AR must not expose the AP-only category filter');
assert.match(arWorkspaceMarkup,/1 invoices \| 0 adjustments/,'a stale AP-only account filter must not silently remove AR invoices');

const detail=renderToStaticMarkup(<AuthoritativeDocumentDetail document={bill} kind="AP" entityId={entityId} returnContext={{view:{query:'Evidence',status:'PARTIALLY_PAID',from:'2026-08-01',through:'2026-08-31',counterparty:'Evidence Vendor',accountCode:'610000',page:2}}} onBack={()=>{}}/>);
assert.match(detail,/Back to AP bills/);
assert.match(detail,/Entity 11111111-1111-4111-8111-111111111111/);
assert.match(detail,/authoritative list revision 3/);
assert.match(detail,/search Evidence/);
assert.match(detail,/vendor Evidence Vendor/);
assert.match(detail,/category 610000/);
assert.match(detail,/page 2/);
assert.match(detail,/cannot create, edit, approve, pay, allocate, post, print, export, or synchronize/);
assert.match(detail,/class="authoritative-document-detail-summary"/,'full-page AP/AR evidence must elevate retained counterparty, amount, balance, and due-date facts');
assert.match(detail,/Original amount/);
assert.doesNotMatch(detail,/<input|<select|>Approve<|>Post<|>Pay</i);
assert.match(detail,/class="table-wrap authoritative-document-detail-table" role="region" tabindex="0" aria-label="Bill evidence fields; scroll horizontally to view every column"/,'full-page evidence fields must remain keyboard-scrollable at narrow widths');
assert.match(detail,/<th scope="row">Entity<\/th>/,'full-page evidence field labels must expose row-header semantics');

const postedJournalId='66666666-6666-4666-8666-666666666666';
const completeBill={...bill,posted_journal_entry_id:postedJournalId,journal_entry_id:postedJournalId,journal_status:'POSTED',journal_revision:4,lineage:{entity_id:entityId,record_id:bill.business_document_id,record_revision:3,source_document_id:'77777777-7777-4777-8777-777777777777',source_document_revision:1,receipt_id:'88888888-8888-4888-8888-888888888888',receipt_revision:2,mapping_snapshot_id:'99999999-9999-4999-8999-999999999999',mapping_version:4,audit_event_ids:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],posted_journal_entry_id:postedJournalId,posted_journal_revision:4,ledger_line_ids:['cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd']}};
const completeLineage=authoritativeLineageFor(completeBill,entityId);
assert.equal(completeLineage?.posted_journal_entry_id,postedJournalId,'only a lineage set bound to the same exact record and posted journal may be exposed');
assert.equal(completeLineage?.audit_event_ids.length,2);
const completeDetail=renderToStaticMarkup(<AuthoritativeDocumentDetail document={completeBill} kind="AP" entityId={entityId} onBack={()=>{}}/>);
assert.match(completeDetail,/Immutable authoritative lineage/);
assert.match(completeDetail,/Mapping snapshot/);
assert.doesNotMatch(completeDetail,/BLOCKED — authoritative lineage unavailable/,'a complete same-revision API lineage response must not be unconditionally blocked');
const mismatchedLineage={...completeBill,lineage:{...completeBill.lineage,record_revision:2}};
assert.equal(authoritativeLineageFor(mismatchedLineage,entityId),null,'a stale or mismatched record revision must fail closed');
const mismatchedDetail=renderToStaticMarkup(<AuthoritativeDocumentDetail document={mismatchedLineage} kind="AP" entityId={entityId} onBack={()=>{}}/>);
assert.match(mismatchedDetail,/BLOCKED — authoritative lineage unavailable/);

const adjustmentList=renderToStaticMarkup(<AuthoritativeAdjustmentSummary title="AP adjustments" adjustments={[adjustment]} onOpen={()=>{}}/>);
assert.match(adjustmentList,/AP_VENDOR_CREDIT/);
assert.match(adjustmentList,/Open evidence/);
const adjustmentDetail=renderToStaticMarkup(<AuthoritativeAdjustmentDetail adjustment={adjustment} side="AP" entityId={entityId} onBack={()=>{}}/>);
assert.match(adjustmentDetail,/Back to AP adjustments/);
assert.match(adjustmentDetail,/authoritative adjustment revision 2/);
assert.match(adjustmentDetail,/cannot create, edit, apply, refund, approve, post, reverse, print, export, or synchronize/);
assert.match(adjustmentList,/class="table-wrap authoritative-document-table" role="region" tabindex="0" aria-label="AP adjustments; scroll horizontally to view every column"/);
assert.match(adjustmentDetail,/class="table-wrap authoritative-document-detail-table" role="region" tabindex="0" aria-label="AP adjustment evidence fields; scroll horizontally to view every column"/);

const completeAdjustment={...adjustment,status:'POSTED',journal_entry_id:postedJournalId,journal_status:'POSTED',journal_revision:5,lineage:{...completeBill.lineage,record_id:adjustment.business_adjustment_id,record_revision:2,posted_journal_entry_id:postedJournalId,posted_journal_revision:5}};
assert.equal(authoritativeLineageFor(completeAdjustment,entityId)?.posted_journal_revision,5,'adjustment lineage must also bind to its own exact immutable revision');
const completeAdjustmentDetail=renderToStaticMarkup(<AuthoritativeAdjustmentDetail adjustment={completeAdjustment} side="AP" entityId={entityId} onBack={()=>{}}/>);
assert.match(completeAdjustmentDetail,/Immutable authoritative lineage/);
assert.doesNotMatch(completeAdjustmentDetail,/BLOCKED — authoritative lineage unavailable/);

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
const styles=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
assert.match(styles,/\.authoritative-document-table \.tbl\{min-width:940px;table-layout:fixed;\}/,'wide AP/AR evidence tables must be contained in their own scroll region');
assert.match(styles,/\.authoritative-document-detail-table \.tbl\{min-width:720px;table-layout:fixed;\}/,'four-column detail facts must retain readable columns without overflowing the page');
assert.match(styles,/\.authoritative-document-summary>span\{position:relative;min-height:116px/,'summary cards must retain a stable visual hierarchy');
assert.match(styles,/\.authoritative-list-filters\{display:grid;grid-template-columns:minmax\(220px,2fr\)/,'wide AP\/AR filters must align as a readable grid');
assert.match(styles,/@media \(max-width:720px\)\{\.authoritative-document-intro\{grid-template-columns:minmax\(0,1fr\)/,'narrow AP\/AR filters and evidence guidance must collapse before the page overflows');

console.log('authoritative-document-evidence: read-only AP/AR list, detail, Back, and empty-state contracts verified');
