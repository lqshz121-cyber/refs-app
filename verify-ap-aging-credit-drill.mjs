import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localApAgingEvidence } from './src/aging-local-evidence.js';

const bill = {bill_id:3,bill_no:'B-3',entity_id:1,vendor_id:2,vendor_name:'Vendor',status:'APPROVED',amount:1000,due_date:'2026-07-01',je_number:'B-3'};
const billJe = {je_number:'B-3',posting_status:'POSTED',entity_id:1,lines:[{account_code:'291001',credit_amount:1000}]};
const creditJe = {je_number:'CR-3',je_date:'2026-07-20',source_system:'AP_CREDIT',posting_status:'POSTED',entity_id:1,vendor_id:2,source_bill_no:'B-3',applied_amount:200,lines:[{account_code:'291001',debit_amount:200}]};
const row = localApAgingEvidence(bill,[billJe,creditJe],[],'2026-07-31',[{canReduceAging:true,bill,applicationAmount:200,journal:creditJe}]);
assert.equal(row.applied_credit_amount,200);
assert.equal(row.applied_credits[0].journal.je_number,'CR-3');
const ui = readFileSync(new URL('./src/module-ap.jsx',import.meta.url),'utf8');
assert.match(ui,/onOpenCredit=\{\(creditKey,scope\)=>openAgingCreditDetail\(creditKey,scope\)\}/);
assert.match(ui,/Credit evidence/);
assert.match(ui,/agingReturn=\{agingDetailScope\}/, 'a Bill opened from AP Aging receives the retained aging scope');
assert.match(ui,/Back to AP Aging/, 'Bill detail visibly returns to AP Aging rather than a generic Expenses list');
assert.match(ui,/localApAgingReturnScopeLabel\(agingReturn\)/, 'Bill return shows vendor, bucket, and as-of scope');
console.log('AP aging credit drill: applied credit detail retains an Aging-origin action');
