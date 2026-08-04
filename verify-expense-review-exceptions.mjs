import assert from 'node:assert/strict';
import { localExpenseReviewExceptions } from './src/expense-review-exceptions.js';

const rows = localExpenseReviewExceptions({
  bills:[{bill_id:'b1',bill_no:'B-1',bill_date:'2026-07-02',vendor_id:'v1',vendor_name:'Related owner',account_code:'612000',amount:100,paymentEvidence:{billState:'VALID_POSTED_AP'}}],
  vendorCredits:[{journal:{je_number:'JE-C1',je_date:'2026-07-03'},creditAmount:40,unappliedAmount:40,state:'POSTED_UNAPPLIED_CREDIT',auditState:'POSTED_AUDIT_RETAINED',canReduceAging:false,creditDimensions:{propertyIds:[],projectIds:[]}}],
  vendors:[{vendor_id:'v1',is_related_party:true}],
  coa:[{account_code:'612000',account_type:'EXPENSE'}],
});
assert.equal(rows.length,2);
assert.equal(rows.find(row=>row.source_kind==='BILL').reason,'RELATED_PARTY_REVIEW');
assert.equal(rows.find(row=>row.source_kind==='VENDOR_CREDIT').workflow_state,'HELD');
assert.ok(rows.every(row=>row.can_resolve===false));
console.log('expense review exceptions: retained evidence, review-only state, and no auto-resolution verified');
