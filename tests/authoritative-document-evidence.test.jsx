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
const displayConfig={entityId,periodId,scopePresentation:{entityLabel:'REFS US Staging',periodLabel:'August 2026'}};
const bill={business_document_id:'22222222-2222-4222-8222-222222222222',bill_no:'B-100',vendor_name:'Evidence Vendor',bill_date:'2026-08-01',due_date:'2026-08-31',amount:125.25,open_balance:25.25,currency:'USD',status:'PARTIALLY_PAID',revision:3,period_id:periodId,account_code:'610000',je_number:null,description:'Retained bill evidence'};
const adjustment={business_adjustment_id:'44444444-4444-4444-8444-444444444444',adjustment_kind:'AP_VENDOR_CREDIT',business_document_id:null,source_adjustment_id:null,amount:10,currency:'USD',accounting_date:'2026-08-02',period_id:periodId,reason:'Retained credit evidence',status:'DRAFT',version:2,journal_entry_id:null,journal_status:null,journal_revision:null,created_at:'2026-08-02T00:00:00.000Z'};

const list=renderToStaticMarkup(<AuthoritativeDocumentTable title="AP bills" documents={[bill]} kind="AP" onOpen={()=>{}}/>);
assert.match(list,/1 bill/);
assert.match(list,/Details/);
assert.match(list,/View details/);
assert.doesNotMatch(list,/Authoritative API rows only|Open evidence/);
assert.match(list,/Open balance/);
assert.match(list,/Evidence Vendor/);
assert.match(list,/id="authoritative-document-22222222-2222-4222-8222-222222222222"/);
assert.match(list,/class="table-wrap authoritative-document-table" role="region" tabindex="0" aria-label="AP bills; scroll horizontally to view every column"/,'AP/AR list evidence must be reachable through a labelled keyboard-focusable horizontal scroll region');
assert.match(list,/<th scope="col">Bill<\/th>/,'data-table headers must have column semantics');

const workspaceMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[bill]} adjustments={[adjustment]} view={{query:'Evidence',status:'PARTIALLY_PAID',from:'2026-08-01',through:'2026-08-31',counterparty:'Evidence Vendor',accountCode:'610000',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(workspaceMarkup,/Payables presentation filters/);
assert.match(workspaceMarkup,/authoritative-document-page-head/,'payables and receivables must use the shared authoritative workspace header');
assert.match(workspaceMarkup,/aria-selected="true" class="tab tab-on">All transactions</,'the mixed AP state must have an explicit selected tab rather than masquerading as Bills');
const workspaceSource=fs.readFileSync(path.join(process.cwd(),'src','authoritative-workspace.jsx'),'utf8');
assert.doesNotMatch(workspaceSource,/'Not retained'/,'AP/AR visible missing-value placeholders must use plain product language instead of storage terminology');
assert.doesNotMatch(workspaceSource,/\{bill&&<label>Transaction type <select/,'Expenses tabs already select All transactions, Bills, or Vendor credits; the filter toolbar must not repeat the same control');
assert.match(workspaceMarkup,/Vendor credits/);
assert.match(workspaceMarkup,/Category <select/);
assert.match(workspaceMarkup,/Payee/);
assert.match(workspaceMarkup,/All payees/);
assert.match(workspaceMarkup,/All categories/);
assert.doesNotMatch(workspaceMarkup,/Category \(offset account\)|All retained vendors|All retained offset accounts/,'Expenses filters should use concise accounting labels without exposing storage terminology');
assert.match(workspaceMarkup,/Reset filters/);
assert.match(workspaceMarkup,/>Reset<\/button><button[^>]*>Apply<\/button>/,'Expenses secondary filters must stage Reset and Apply without removing the global reset');
assert.match(workspaceMarkup,/EXPENSES \/ ACCOUNTS PAYABLE/);
assert.match(workspaceMarkup,/Review bills, vendor credits, and AP aging\./);
assert.doesNotMatch(workspaceMarkup,/Bills, credits, and AP aging from the accounting API/,'the Expenses header must not expose implementation-oriented API copy');
assert.match(workspaceMarkup,/Bills/);
assert.doesNotMatch(workspaceMarkup,/API total|Visible adjustments/,'Expenses must not repeat its list counts as KPI cards');
assert.match(workspaceMarkup,/READ ONLY/);
assert.match(workspaceMarkup,/authoritative-ap-ar-presentation/);
assert.match(workspaceMarkup,/class="tab tab-on"/,'the selected AP view must use the shared tab geometry');
assert.match(workspaceMarkup,/class="tab"/,'available AP views must use the shared tab geometry instead of browser-native buttons');
assert.match(workspaceMarkup,/Vendor credits/);
assert.match(workspaceMarkup,/AP Aging/);
assert.doesNotMatch(workspaceMarkup,/AP Aging unavailable/,'AP aging has an authenticated API contract and must be reachable');
assert.match(workspaceMarkup,/id="authoritative-ap-aging-launch"/,'Back from AP aging must restore focus to the tab that opened it');
assert.match(workspaceMarkup,/Vendors unavailable/);
assert.match(workspaceMarkup,/class="tab-unavailable" role="tab" aria-selected="false" aria-disabled="true" aria-label="Vendors unavailable"/,'unavailable AP/AR views must retain tab semantics and shared visual geometry without becoming interactive');
assert.doesNotMatch(workspaceMarkup,/class="tab-unavailable" role="note"/,'a child of tablist must not use a non-tab role');
assert.doesNotMatch(workspaceMarkup,/<button[^>]*disabled[^>]*>AP Aging<\/button>/);
const apArPresentationSource=fs.readFileSync(path.join(process.cwd(),'src','authoritative-ap-ar-view.jsx'),'utf8');
assert.doesNotMatch(apArPresentationSource,/seed\.js|repo\.js|localStorage|legacy-demo-app|data\.js|accounting-api/,
  'the AP/AR presentation shell must receive authority facts as slots and never load local or API state itself');
assert.doesNotMatch(workspaceMarkup,/Document and adjustment evidence/,'the compact workspace must not repeat a long internal contract block');
assert.match(workspaceMarkup,/Search <input/);
assert.match(workspaceMarkup,/<summary>Filter \(4\)<\/summary>/,'Expenses must use the observed concise QBO Filter label while showing its active-filter count');
assert.doesNotMatch(workspaceMarkup,/<summary>More filters/,'Expenses must not retain the longer disclosure label');
assert.match(workspaceMarkup,/>From <input[^>]*type="date"/);
assert.match(workspaceMarkup,/>To <input[^>]*type="date"/,'Expenses must use the observed QBO From / To date labels without changing its through-state key');
assert.doesNotMatch(workspaceMarkup,/>Through <input[^>]*type="date"/,'Expenses must not expose the older Through label');
assert.match(workspaceMarkup,/To: 2026-08-31/,'the applied Expenses scope must use the same visible To vocabulary');
assert.match(workspaceMarkup,/Payee: Evidence Vendor/);
assert.match(workspaceMarkup,/Category: 610000/);
assert.match(workspaceMarkup,/Reset filters/);
assert.match(workspaceMarkup,/Status: PARTIALLY_PAID/);
assert.match(workspaceMarkup,/2026-08-01/);
assert.match(workspaceMarkup,/1 result/,'Expenses must summarize the currently rendered result set without exposing separate internal document and adjustment counts');
assert.doesNotMatch(workspaceMarkup,/No adjustments match these presentation filters/,'a mixed Expenses result must not append an empty adjustment card below visible Bills');
assert.doesNotMatch(workspaceMarkup,/aria-label="Expenses API summary"/,'QBO-style Expenses keeps its result count beside the filters rather than repeating KPI cards');
assert.doesNotMatch(workspaceMarkup,/authoritative-document-intro/,'AP/AR must not duplicate the evidence contract above the filters');
assert.doesNotMatch(workspaceMarkup,/>Filters</,'Expenses must not repeat a heading above its already labelled filter controls');
assert.match(workspaceMarkup,/authoritative-secondary-disclosure/,'secondary WBS evidence must stay available without lengthening the default page');

const emptyExpenseMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[]} adjustments={[]} view={{query:'',status:'ALL',transactionType:'ALL',from:'',through:'',counterparty:'ALL',accountCode:'ALL',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(emptyExpenseMarkup,/All records/,'the default Expenses scope should use concise user-facing copy');
assert.match(emptyExpenseMarkup,/No expenses found/);
assert.match(emptyExpenseMarkup,/Try changing the filters\. Empty results do not confirm a zero balance\./);
assert.doesNotMatch(emptyExpenseMarkup,/scoped API result|zero activity/,'Expenses empty-state copy must preserve the accounting caveat without exposing transport language');
assert.equal((emptyExpenseMarkup.match(/No expenses found/g)||[]).length,1,'an empty Expenses scope must render one clear empty title');
assert.doesNotMatch(emptyExpenseMarkup,/No authoritative adjustments in this scope/);

const noMatchExpenseMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[bill]} adjustments={[adjustment]} view={{query:'No such expense',status:'ALL',transactionType:'ALL',from:'',through:'',counterparty:'ALL',accountCode:'ALL',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.equal((noMatchExpenseMarkup.match(/No expenses match these filters/g)||[]).length,1,'a filtered mixed Expenses scope must render one clear empty state');
assert.doesNotMatch(noMatchExpenseMarkup,/No bills match|No adjustments match|No authoritative adjustments/,'the mixed Expenses empty state must not split internal object families into separate cards');

const creditsOnlyMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[bill]} adjustments={[adjustment]} view={{query:'',status:'ALL',transactionType:'VENDOR_CREDITS',from:'',through:'',counterparty:'ALL',accountCode:'ALL',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(creditsOnlyMarkup,/Vendor credits/);
assert.match(creditsOnlyMarkup,/AP_VENDOR_CREDIT/);
assert.match(creditsOnlyMarkup,/1 result/,'Vendor credits must count the visible credit list rather than reporting zero bills');
assert.doesNotMatch(creditsOnlyMarkup,/0 bills|adjustments/,'the visible result count must not expose unrelated internal object types');
assert.doesNotMatch(creditsOnlyMarkup,/B-100/,'a Vendor credits presentation scope must not render Bill list rows');
assert.doesNotMatch(creditsOnlyMarkup,/aria-label="Payables document list facts"|No bills match/,
  'the Vendor credits tab must not prepend an unrelated Bill list or Bill empty state');
const vendorCredits=Array.from({length:26},(_,index)=>({...adjustment,business_adjustment_id:`44444444-4444-4444-8444-${String(index+1).padStart(12,'0')}`,reason:`Retained credit ${index+1}`}));
const vendorCreditPageOne=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[]} adjustments={vendorCredits} view={{query:'',status:'ALL',transactionType:'VENDOR_CREDITS',from:'',through:'',counterparty:'ALL',accountCode:'ALL',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.equal((vendorCreditPageOne.match(/AP_VENDOR_CREDIT/g)||[]).length,25,'Vendor credits must use the retained 25-row list page instead of creating an unbounded Expenses page');
assert.match(vendorCreditPageOne,/aria-label="Vendor credit pages"/);assert.match(vendorCreditPageOne,/Page 1 of 2/);assert.match(vendorCreditPageOne,/>Next</);
const vendorCreditPageTwo=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[]} adjustments={vendorCredits} view={{query:'',status:'ALL',transactionType:'VENDOR_CREDITS',from:'',through:'',counterparty:'ALL',accountCode:'ALL',page:2,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.equal((vendorCreditPageTwo.match(/AP_VENDOR_CREDIT/g)||[]).length,1,'the final Vendor credit page must contain only its remaining retained row');assert.match(vendorCreditPageTwo,/Page 2 of 2/);
const emptyCreditsMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[]} adjustments={[]} view={{query:'',status:'ALL',transactionType:'VENDOR_CREDITS',from:'',through:'',counterparty:'ALL',accountCode:'ALL',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(emptyCreditsMarkup,/No vendor credits found/,'an empty Vendor credits tab must never render a blank workspace');
assert.match(emptyCreditsMarkup,/not evidence of a zero AP balance/);
assert.doesNotMatch(emptyCreditsMarkup,/No expenses found|No authoritative adjustments in this scope/,'the credit-specific empty state must be singular and user-facing');

const billsOnlyMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AP" documents={[bill]} adjustments={[adjustment]} view={{query:'',status:'ALL',transactionType:'BILLS',from:'',through:'',counterparty:'ALL',accountCode:'ALL',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(billsOnlyMarkup,/B-100/);
assert.match(billsOnlyMarkup,/1 result/,'Bills must count the visible Bill list only');
assert.doesNotMatch(billsOnlyMarkup,/aria-label="Payables adjustment list facts"|No authoritative adjustments in this scope/,
  'the Bills tab must not append an unrelated adjustment list or adjustment empty state');

const invoice={...bill,business_document_id:'55555555-5555-4555-8555-555555555555',inv_no:'I-100',customer_name:'Evidence Customer',inv_date:'2026-08-01'};
const invoiceList=renderToStaticMarkup(<AuthoritativeDocumentTable title="AR invoices" documents={[invoice]} kind="AR" onOpen={()=>{}}/>);
assert.match(invoiceList,/1 invoice/);assert.match(invoiceList,/>Details<\/th>/);assert.match(invoiceList,/>View details<\/button>/);
assert.doesNotMatch(invoiceList,/Authoritative API rows only|>Evidence<\/th>|Open evidence/,'AR invoices must share the concise AP detail-action vocabulary');
const arAdjustmentList=renderToStaticMarkup(<AuthoritativeAdjustmentSummary title="AR adjustments" adjustments={[adjustment]} kind="AR" onOpen={()=>{}}/>);
assert.match(arAdjustmentList,/1 adjustment/);assert.match(arAdjustmentList,/>Details<\/th>/);assert.match(arAdjustmentList,/>View details<\/button>/);
assert.doesNotMatch(arAdjustmentList,/Authoritative adjustment rows only|>Evidence<\/th>|Open evidence/,'AR adjustments must share the concise AP detail-action vocabulary');
const arWorkspaceMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AR" documents={[invoice]} adjustments={[]} view={{query:'',status:'ALL',from:'',through:'',accountCode:'999999',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(arWorkspaceMarkup,/id="authoritative-ar-aging-launch"/,'Back from AR aging must restore focus to the tab that opened it');
assert.match(arWorkspaceMarkup,/REVENUE \/ ACCOUNTS RECEIVABLE/);
assert.match(arWorkspaceMarkup,/Review invoices and AR aging\./);
assert.doesNotMatch(arWorkspaceMarkup,/Invoices, receipts, and AR aging from the accounting API|from the accounting API/,
  'the Accounts Receivable header must describe only available views without exposing transport language');
assert.match(arWorkspaceMarkup,/All records/);
assert.match(arWorkspaceMarkup,/After filters/);
assert.doesNotMatch(arWorkspaceMarkup,/API total|All retained API rows|>Filtered</,
  'Accounts Receivable summary copy must use concise business language without exposing API or storage terminology');
assert.match(arWorkspaceMarkup,/Receivables/);
assert.match(arWorkspaceMarkup,/Invoices/);
assert.match(arWorkspaceMarkup,/Invoice, customer, account, or reference/);
assert.match(arWorkspaceMarkup,/All customers/);
assert.match(arWorkspaceMarkup,/More filters/,'AR secondary date and customer filters must be collapsed by default');
assert.match(arWorkspaceMarkup,/>Through <input[^>]*type="date"/,'Receivables keeps its existing label until separately observed');
assert.doesNotMatch(arWorkspaceMarkup,/<details class="authoritative-list-more-filters" open=""/,'AR More filters must stay closed when no secondary filter is active');
assert.doesNotMatch(arWorkspaceMarkup,/All retained customers/,'the AR customer filter must not expose storage terminology');
assert.doesNotMatch(arWorkspaceMarkup,/Category \(offset account\)/,'AR must not expose the AP-only category filter');
assert.match(arWorkspaceMarkup,/1 result/,'a stale AP-only account filter must not silently remove AR invoices');
const arNoMatchMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AR" documents={[invoice]} adjustments={[]} view={{query:'No such invoice',status:'ALL',from:'',through:'',counterparty:'ALL',accountCode:'ALL',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.match(arNoMatchMarkup,/No invoices match these filters/);
assert.match(arNoMatchMarkup,/Try changing or resetting the filters\. This result does not confirm a zero balance\./);
assert.match(arNoMatchMarkup,/No adjustments found/);
assert.doesNotMatch(arNoMatchMarkup,/match these presentation filters|see retained list facts|>No authoritative adjustments in this scope</,
  'AR empty states must use concise user-facing language while retaining the zero-balance caveat');
const arFilteredMarkup=renderToStaticMarkup(<AuthoritativeDocumentWorkspace kind="AR" documents={[invoice]} adjustments={[]} view={{query:'',status:'ALL',from:'2026-08-01',through:'',counterparty:'Evidence Customer',accountCode:'ALL',page:1,pageSize:25}} onViewChange={()=>{}} onOpenDocument={()=>{}} onOpenAdjustment={()=>{}}/>);
assert.doesNotMatch(arFilteredMarkup,/<details class="authoritative-list-more-filters" open="">/,'active AR secondary filters must stay summarized rather than lengthening the page');
assert.match(arFilteredMarkup,/More filters \(2\)/);

const documentReturnContext={entityId,periodId,documentId:bill.business_document_id,documentRevision:bill.revision,documentKind:'AP',documentPeriodId:periodId,view:{query:'Evidence',status:'PARTIALLY_PAID',transactionType:'ALL',from:'2026-08-01',through:'2026-08-31',counterparty:'Evidence Vendor',accountCode:'610000',page:2}};
const detail=renderToStaticMarkup(<AuthoritativeDocumentDetail document={bill} kind="AP" entityId={entityId} config={displayConfig} returnContext={documentReturnContext} onBack={()=>{}}/>);
assert.match(detail,/Back to AP bills/);
assert.match(detail,/<details class="authoritative-return-context"><summary>List filters retained<\/summary>/,
  'the exact list return scope must remain available without forcing a long filter string into the Back row');
assert.match(detail,/REFS US Staging/);
assert.match(detail,/title="Entity ID: 11111111-1111-4111-8111-111111111111"/,'the full entity identifier remains an audit tooltip, not visible page text');
assert.match(detail,/August 2026/);
assert.match(detail,/title="Period ID: 33333333-3333-4333-8333-333333333333"/,'the full period identifier remains an audit tooltip, not visible page text');
assert.doesNotMatch(detail,/Entity 11111111-1111-4111-8111-111111111111/,'the Back context must not expose a raw entity UUID');
assert.match(detail,/authoritative list revision 3/);
assert.match(detail,/search Evidence/);
assert.match(detail,/vendor Evidence Vendor/);
assert.match(detail,/category 610000/);
assert.match(detail,/transaction type ALL/);
assert.match(detail,/page 2/);
assert.match(detail,/Read-only retained evidence\. Document actions are unavailable here\./);
assert.match(detail,/class="authoritative-document-detail-summary"/,'full-page AP/AR evidence must elevate retained counterparty, amount, balance, and due-date facts');
assert.match(detail,/Original amount/);
assert.doesNotMatch(detail,/<input|<select|>Approve<|>Post<|>Pay</i);
assert.match(detail,/class="table-wrap authoritative-document-detail-table" role="region" tabindex="0" aria-label="Bill evidence fields; scroll horizontally to view every column"/,'full-page evidence fields must remain keyboard-scrollable at narrow widths');
assert.match(detail,/<th scope="row">Entity<\/th>/,'full-page evidence field labels must expose row-header semantics');
const retainedFactsTable=detail.match(/<div class="table-wrap authoritative-document-detail-table"[^>]*><table class="tbl">([\s\S]*?)<\/table><\/div>/)?.[1]||'';
assert.doesNotMatch(retainedFactsTable,/<th scope="row">(?:Vendor|Bill date|Due date|Status|Original amount|Open balance)<\/th>/,
  'header and summary facts must not be repeated in the retained-facts table');
assert.match(retainedFactsTable,/<th scope="row">Offset account<\/th>[\s\S]*<th scope="row">Posted journal<\/th>[\s\S]*<th scope="row">Period<\/th>[\s\S]*<th scope="row">Description<\/th>/,
  'the retained-facts table must keep the unique accounting evidence fields');

const postedJournalId='66666666-6666-4666-8666-666666666666';
const completeBill={...bill,posted_journal_entry_id:postedJournalId,journal_entry_id:postedJournalId,journal_status:'POSTED',journal_revision:4,lineage:{entity_id:entityId,record_id:bill.business_document_id,record_revision:3,source_document_id:'77777777-7777-4777-8777-777777777777',source_document_revision:1,receipt_id:'88888888-8888-4888-8888-888888888888',receipt_revision:2,mapping_snapshot_id:'99999999-9999-4999-8999-999999999999',mapping_version:4,audit_event_ids:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],posted_journal_entry_id:postedJournalId,posted_journal_revision:4,ledger_line_ids:['cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd']}};
const completeLineage=authoritativeLineageFor(completeBill,entityId);
assert.equal(completeLineage?.posted_journal_entry_id,postedJournalId,'only a lineage set bound to the same exact record and posted journal may be exposed');
assert.equal(completeLineage?.audit_event_ids.length,2);
const completeDetail=renderToStaticMarkup(<AuthoritativeDocumentDetail document={completeBill} kind="AP" entityId={entityId} config={displayConfig} returnContext={documentReturnContext} onBack={()=>{}}/>);
assert.match(completeDetail,/Immutable authoritative lineage/);
assert.match(completeDetail,/<details class="authoritative-secondary-disclosure authoritative-lineage" aria-label="Bill immutable lineage"><summary><span>Immutable authoritative lineage<\/span><span class="badge badge-muted">POSTED EVIDENCE<\/span><\/summary>/,
  'complete lineage must remain available in one default-closed shared disclosure');
assert.doesNotMatch(completeDetail,/authoritative-lineage"[^>]* open/,'complete lineage must not lengthen the default evidence page');
assert.match(completeDetail,/Mapping snapshot/);
assert.doesNotMatch(completeDetail,/authoritative lineage unavailable/,'a complete same-revision API lineage response must not be unconditionally blocked');
const mismatchedLineage={...completeBill,lineage:{...completeBill.lineage,record_revision:2}};
assert.equal(authoritativeLineageFor(mismatchedLineage,entityId),null,'a stale or mismatched record revision must fail closed');
const mismatchedDetail=renderToStaticMarkup(<AuthoritativeDocumentDetail document={mismatchedLineage} kind="AP" entityId={entityId} config={displayConfig} returnContext={documentReturnContext} onBack={()=>{}}/>);
assert.match(mismatchedDetail,/BLOCKED[\s\S]*authoritative lineage unavailable/);
assert.match(mismatchedDetail,/Source, receipt, mapping, audit, journal, and ledger links were not returned for this revision\./);
assert.match(mismatchedDetail,/List facts remain read only\./);
assert.doesNotMatch(mismatchedDetail,/The list reader has not returned|The retained list facts below/);
const crossPeriodDetail=renderToStaticMarkup(<AuthoritativeDocumentDetail document={{...bill,period_id:'55555555-5555-4555-8555-555555555555'}} kind="AP" entityId={entityId} config={displayConfig} returnContext={documentReturnContext} onBack={()=>{}}/>);
assert.match(crossPeriodDetail,/BLOCKED — immutable document scope mismatch/,'a document from another period must never mount evidence under the selected period return context');
assert.doesNotMatch(crossPeriodDetail,/Original amount|Offset account/,'cross-period list facts must block before detail evidence');

const adjustmentList=renderToStaticMarkup(<AuthoritativeAdjustmentSummary title="AP adjustments" adjustments={[adjustment]} kind="AP" onOpen={()=>{}}/>);
assert.match(adjustmentList,/AP_VENDOR_CREDIT/);
assert.match(adjustmentList,/1 adjustment/);
assert.match(adjustmentList,/Details/);
assert.match(adjustmentList,/View details/);
assert.doesNotMatch(adjustmentList,/Authoritative adjustment rows only|Open evidence/);
const adjustmentDetail=renderToStaticMarkup(<AuthoritativeAdjustmentDetail adjustment={adjustment} side="AP" entityId={entityId} config={displayConfig} returnContext={{view:{query:'Credit evidence',status:'POSTED',transactionType:'VENDOR_CREDIT',from:'2026-08-01',through:'2026-08-31',counterparty:'Evidence Vendor',accountCode:'610000',page:2}}} onBack={()=>{}}/>);
assert.match(adjustmentDetail,/Back to AP adjustments/);
assert.match(adjustmentDetail,/<details class="authoritative-return-context"><summary>List filters retained<\/summary>/,'adjustment Back context must use the same compact disclosure as Bill and Invoice evidence');
assert.match(adjustmentDetail,/REFS US Staging/);
assert.match(adjustmentDetail,/August 2026/);
assert.doesNotMatch(adjustmentDetail,/Entity 11111111-1111-4111-8111-111111111111/,'adjustment evidence must keep the entity UUID out of visible text');
assert.match(adjustmentDetail,/authoritative list revision 2/);
assert.match(adjustmentDetail,/search Credit evidence/);
assert.match(adjustmentDetail,/vendor Evidence Vendor/);
assert.match(adjustmentDetail,/transaction type VENDOR_CREDIT/);
assert.match(adjustmentDetail,/page 2/);
assert.match(adjustmentDetail,/Read-only retained evidence\. Adjustment actions are unavailable here\./);
assert.match(adjustmentDetail,/class="authoritative-document-detail-summary" aria-label="AP adjustment evidence summary"/,
  'adjustment evidence must elevate amount, period, currency, and revision into the shared compact summary');
assert.match(adjustmentDetail,/<details class="authoritative-secondary-disclosure authoritative-adjustment-fields"><summary><span>Adjustment evidence fields<\/span><span class="badge badge-muted">READ ONLY<\/span><\/summary>/,
  'secondary adjustment audit fields must remain available in a default-closed disclosure');
assert.doesNotMatch(adjustmentDetail,/authoritative-adjustment-fields"[^>]* open/,'secondary adjustment fields must not lengthen the default page');
assert.match(adjustmentList,/class="table-wrap authoritative-adjustment-table" role="region" tabindex="0" aria-label="AP adjustments; scroll horizontally to view every column"/,'the adjustment list must own a keyboard-focusable table scroller instead of inheriting document-table widths');
assert.match(adjustmentDetail,/class="table-wrap authoritative-document-detail-table" role="region" tabindex="0" aria-label="AP adjustment evidence fields; scroll horizontally to view every column"/);
assert.match(adjustmentDetail,/<th scope="row">Reason<\/th><td colSpan="3">Retained credit evidence<\/td>/,'the compact detail must retain the complete adjustment reason');

const completeAdjustment={...adjustment,status:'POSTED',journal_entry_id:postedJournalId,journal_status:'POSTED',journal_revision:5,lineage:{...completeBill.lineage,record_id:adjustment.business_adjustment_id,record_revision:2,posted_journal_entry_id:postedJournalId,posted_journal_revision:5}};
assert.equal(authoritativeLineageFor(completeAdjustment,entityId)?.posted_journal_revision,5,'adjustment lineage must also bind to its own exact immutable revision');
const completeAdjustmentDetail=renderToStaticMarkup(<AuthoritativeAdjustmentDetail adjustment={completeAdjustment} side="AP" entityId={entityId} onBack={()=>{}}/>);
assert.match(completeAdjustmentDetail,/Immutable authoritative lineage/);
assert.match(completeAdjustmentDetail,/aria-label="Adjustment immutable lineage"/,'adjustments must use the same compact lineage disclosure');
assert.doesNotMatch(completeAdjustmentDetail,/authoritative lineage unavailable/);

const empty=renderToStaticMarkup(<AuthoritativeDocumentTable title="AR invoices" documents={[]} kind="AR"/>);
assert.match(empty,/does not prove that an upstream source is empty\. It is not evidence of a zero balance\./);
assert.doesNotMatch(empty,/<table/);

const app=fs.readFileSync(path.join(process.cwd(),'src','authoritative-app.jsx'),'utf8');
const apRoute=app.slice(app.indexOf("route === 'payables'"),app.indexOf("route === 'receivables'"));
const arRoute=app.slice(app.indexOf("route === 'receivables'"),app.indexOf("route === 'bank'"));
for(const route of [apRoute,arRoute]){
  assert.doesNotMatch(route,/AuthoritativeWorkflow(?:Adjustment)?Table|onWorkflow=\{workflow\}/,'AP/AR evidence routes must not expose journal transition controls');
  assert.match(route,/AuthoritativeDocumentDetail/);
  assert.match(route,/AuthoritativeAdjustmentDetail/);
  assert.match(route,/AuthoritativeAdjustmentDetail[\s\S]*?returnContext=\{adjustmentDetail\.returnContext\}/,'adjustment details must receive the exact immutable list return token');
  assert.match(route,/config=\{displayConfig\}/,'AP/AR full-page evidence routes must inherit the shared readable company and period scope');
  assert.match(route,/AuthoritativeDocumentWorkspace/);
}
assert.doesNotMatch(app,/<b>Return context<\/b> Query/,'document and adjustment list context belongs in the full-page Back disclosure, not the global scope bar');
const workspace=fs.readFileSync(path.join(process.cwd(),'src','authoritative-workspace.jsx'),'utf8');
assert.doesNotMatch(workspace,/localStorage|SEED_/,'authoritative AP/AR evidence must not read browser business state');
assert.doesNotMatch(workspace,/from ['"]\.\/repo|from ['"]\.\/seed|from ['"]\.\/data/,'authoritative AP/AR presentation must not import demo business state');
assert.doesNotMatch(workspace,/(?:BLOCKED|Configured entity|Category unavailable) \?|\} \? (?:rev|v|\{)/,'visible AP/AR copy must not expose question-mark replacement characters as separators');
for(const rendered of [detail,completeDetail,adjustmentDetail,completeAdjustmentDetail])assert.doesNotMatch(rendered,/ \? /,'rendered authoritative evidence must use intentional readable separators');
assert.match(workspace,/authoritative-document-workspace stack/,'authoritative AP/AR list facts require a full-page hierarchy rather than a bare table');
assert.match(workspace,/API read · filters do not change records/,'authoritative AP/AR hierarchy must retain a concise read-only boundary');
assert.doesNotMatch(workspace,/presentation contract/,'the list page must not repeat an internal contract as a large visible block');
assert.match(app,/authoritative-scope-bar/,'authoritative shell must display the configured entity and period scope');
assert.match(app,/restoreAuthoritativeReturnContext/,'full-page Back must restore scroll and focus only within the exact configured scope');
assert.match(app,/scrollY:Number\(environment\?\.scrollY\)\|\|0,\s*tableX,/,'AP and AR evidence openers must freeze the contained table position in the immutable return context');
assert.match(app,/getTable:\(\)=>environment\?\.document\?\.querySelector\?\.\('\.authoritative-document-table'\)/,'Bill and invoice Back must restore the exact wide-table position');
assert.match(app,/getTable:\(\)=>environment\?\.document\?\.querySelector\?\.\('\.authoritative-adjustment-table'\)/,'Vendor-credit and adjustment Back must restore the exact wide-table position');
assert.match(workspace,/closest\('\.table-wrap'\)\?\.scrollLeft/,'AP and AR row actions must capture their own contained scroller rather than the page');
const styles=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
assert.match(styles,/\.authoritative-document-workspace,.authoritative-document-workspace>\*,.authoritative-document-table,.authoritative-adjustment-table\{min-width:0;max-width:100%;\}/,'AP/AR workspace descendants must be shrinkable so their table regions, not the page, own narrow-width overflow');
assert.match(styles,/\.authoritative-document-table \.tbl\{min-width:980px;table-layout:fixed;\}/,'wide AP/AR evidence tables must reserve semantic columns inside their own scroll region');
assert.match(styles,/\.authoritative-adjustment-table \.tbl\{min-width:760px;table-layout:fixed;\}/,'six-column adjustment evidence must retain readable columns in its own contained scroller');
assert.match(styles,/\.authoritative-document-detail-table \.tbl\{min-width:720px;table-layout:fixed;\}/,'four-column detail facts must retain readable columns without overflowing the page');
assert.match(styles,/\.authoritative-return-context>summary\{cursor:pointer;list-style:none;white-space:nowrap;\}/,
  'the exact return scope must use a compact, keyboard-native disclosure');
assert.match(styles,/\.authoritative-document-summary>span\{position:relative;min-height:116px/,'summary cards must retain a stable visual hierarchy');
assert.match(styles,/\.authoritative-expense-page-head\{margin-bottom:8px;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;\}/,'Expenses must use the observed compact QBO heading rather than a large decorative hero card');
assert.match(styles,/\.authoritative-expense-page-head \.page-h\{font-size:24px;line-height:1\.1;font-weight:500;\}/,'Expenses heading must retain the observed compact QBO scale');
assert.match(styles,/\.authoritative-expense-filter-card\{padding:8px 0 12px;border:0;border-radius:0;background:transparent;box-shadow:none;\}/,'Expenses filters must remain a compact toolbar instead of a nested card');
assert.match(workspaceSource,/<nav className="pagination"[\s\S]*?className="btn btn-sm btn-ghost"[\s\S]*?Previous[\s\S]*?className="btn btn-sm btn-ghost"[\s\S]*?Next/,'AP/AR list pagination must use the shared button system instead of browser-native controls');
assert.match(styles,/\.pagination\{display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 20px;\}/,'nested AP/AR pagination must receive the shared contained layout');
assert.match(styles,/\.authoritative-list-filters\{display:grid;grid-template-columns:minmax\(220px,2fr\)/,'wide AP\/AR filters must align as a readable grid');
assert.match(styles,/@media\s*\(max-width:1400px\)\s*\{\.authoritative-list-filters\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'AP/AR filters must collapse before the permanent navigation leaves too little workspace width at desktop zoom and tablet sizes');
assert.match(styles,/\.authoritative-list-filters input,\.authoritative-list-filters select\{min-width:0;width:100%;max-width:100%;\}/,'AP/AR controls must not exceed their responsive grid tracks');
assert.match(workspaceSource,/className="authoritative-list-more-filters" onToggle=/,'AP/AR must keep secondary filters in a compact native disclosure');
assert.match(workspaceSource,/<label>\{bill\?'Payee':'Customer'\} <select value=\{filterDraft\.counterparty\}[\s\S]*?\{bill&&\(accountCodes\.length>0\?<label>Category <select value=\{filterDraft\.accountCode\}/,'the compact disclosure must stage the observed AP Payee, shared counterparty behavior, and AP-only Category');
assert.match(workspaceSource,/onClick=\{\(\)=>change\(filterDraft\)\}>Apply<\/button>/,'secondary filter edits must not change the visible result until Apply');
assert.match(styles,/\.authoritative-list-more-filters\[open\]\{grid-column:1\/-1;\}/,'expanded AP/AR filters must stay contained within the filter region');
assert.match(styles,/@media\s*\(max-width:720px\)\s*\{\.authoritative-document-intro(?:,\.authoritative-source-intro)?\{grid-template-columns:minmax\(0,1fr\)/,'narrow AP\/AR filters and evidence guidance must collapse before the page overflows');
assert.doesNotMatch(styles,/repeat\(2,minmax\(0,1fr\);/,'a malformed narrow-layout grid declaration must never prevent later responsive rules from parsing');

console.log('authoritative-document-evidence: read-only AP/AR list, detail, Back, and empty-state contracts verified');
