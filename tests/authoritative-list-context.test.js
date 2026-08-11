import assert from 'node:assert/strict';
import {
  DEFAULT_AUTHORITATIVE_LIST_VIEW,
  authoritativeEvidenceKey,
  createAuthoritativeReturnContext,
  filterAuthoritativeRows,
  normalizeAuthoritativeListView,
  paginateAuthoritativeRows,
  restoreAuthoritativeReturnContext,
} from '../src/authoritative-list-context.js';

const config={entityId:'11111111-1111-4111-8111-111111111111',periodId:'22222222-2222-4222-8222-222222222222'};
const rows=[
  {business_document_id:'33333333-3333-4333-8333-333333333333',bill_no:'B-100',vendor_name:'Alpha Vendor',account_code:'610000',bill_date:'2026-07-01',status:'OPEN'},
  {business_document_id:'44444444-4444-4444-8444-444444444444',bill_no:'B-200',vendor_name:'Beta Vendor',account_code:'220000',bill_date:'2026-08-01',status:'PAID'},
];

assert.deepEqual(normalizeAuthoritativeListView(null),DEFAULT_AUTHORITATIVE_LIST_VIEW);
assert.deepEqual(filterAuthoritativeRows(rows,{query:'beta',status:'PAID',from:'2026-08-01',through:'2026-08-31'},'bill_date'),[rows[1]]);
assert.deepEqual(filterAuthoritativeRows(rows,{from:'2026-08-02'},'bill_date'),[]);
assert.deepEqual(filterAuthoritativeRows(rows,{counterparty:'Beta Vendor',accountCode:'220000'},'bill_date',{counterpartyField:'vendor_name',accountField:'account_code'}),[rows[1]]);
assert.deepEqual(filterAuthoritativeRows(rows,{counterparty:'Beta Vendor',accountCode:'220000'},'bill_date'),rows,'document-only filters must not hide adjustment readers without retained fields');
const reviewRows=[{status:'PENDING_REVIEW'},{status:'PENDING_APPROVAL'},{status:'POSTED'}];
assert.deepEqual(filterAuthoritativeRows(reviewRows,{status:'REVIEW_REQUIRED'},'journal_date'),reviewRows.slice(0,2),'the review queue must include both retained review and approval statuses');
assert.deepEqual(paginateAuthoritativeRows(rows,{page:9,pageSize:1}),{rows:[rows[1]],page:2,pageCount:2,total:2});
assert.equal(authoritativeEvidenceKey('document',rows[0]),rows[0].business_document_id);
assert.equal(authoritativeEvidenceKey('document',{business_document_id:'display-id'}),null);

const context=createAuthoritativeReturnContext({config,view:{query:'Alpha',page:2,pageSize:10},focusId:'open-333',scrollY:420});
assert.equal(context.entityId,config.entityId);
assert.equal(context.periodId,config.periodId);
assert.equal(context.view.query,'Alpha');
assert.equal(context.view.counterparty,'ALL');
assert.equal(context.scrollY,420);

const calls=[];
const environment={
  setTimeout(fn,ms){calls.push(['timer',ms]);fn();},
  scrollTo(value){calls.push(['scroll',value.top]);},
  document:{getElementById(id){return {focus(){calls.push(['focus',id]);}};}},
};
assert.equal(restoreAuthoritativeReturnContext(environment,config,context),true);
assert.deepEqual(calls,[['timer',0],['scroll',420],['focus','open-333']]);
assert.equal(restoreAuthoritativeReturnContext(environment,{...config,entityId:'55555555-5555-4555-8555-555555555555'},context),false);

console.log('authoritative-list-context: filters, pagination, immutable scope, scroll and focus restoration passed');
