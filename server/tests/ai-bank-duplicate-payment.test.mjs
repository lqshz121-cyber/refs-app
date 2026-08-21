import assert from 'node:assert/strict';
import test from 'node:test';
import {detectDuplicateBankPayments} from '../runtime/ai-bank-duplicate-payment.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n%10).repeat(64)}`;
const row=(n,overrides={})=>({bank_source_id:id(n),source_document_id:id(n+100),source_payload_hash:hash(n),entity_id:id(1),accounting_period_id:id(8),bank_account_ref:'OPERATING-001',external_bank_line_id:`BANK-${n}`,transaction_date:'2026-08-19',currency:'USD',amount:'-500.0000',source_admission_status:'ADMITTED',signature_verified:true,...overrides});

test('finds same-day same-amount payments from distinct signed sources with zero accounting authority',()=>{
  const result=detectDuplicateBankPayments([row(1),row(2)],{currentAccountingPeriodId:id(8)}),finding=result.findings[0];
  assert.equal(result.scanned_payment_count,2);assert.equal(result.finding_count,1);assert.equal(finding.payment_count,2);assert.equal(finding.amount,'-500.0000');assert.equal(finding.source_trace.length,2);assert.equal(new Set(finding.source_trace.map(source=>source.bank_source_id)).size,2);assert.deepEqual(finding.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('three equivalent payments become high risk without treating a valid pair as a proven duplicate',()=>{
  const finding=detectDuplicateBankPayments([row(1),row(2),row(3)],{currentAccountingPeriodId:id(8)}).findings[0];
  assert.equal(finding.risk_level,'HIGH');assert.equal(finding.confidence,0.99);assert.match(finding.suggested_action,/Compare every payment/);assert.ok(finding.required_human_fields.includes('duplicate_or_valid_conclusion'));
});

test('does not compare across entity, period, account, date, currency, amount, or non-payment direction',()=>{
  for(const changed of [{entity_id:id(9)},{accounting_period_id:id(7)},{bank_account_ref:'OTHER'},{transaction_date:'2026-08-18'},{currency:'CAD'},{amount:'-501.0000'}])assert.equal(detectDuplicateBankPayments([row(1),row(2,changed)],{currentAccountingPeriodId:id(8)}).finding_count,0);
  assert.throws(()=>detectDuplicateBankPayments([row(1,{amount:'500.0000'})],{currentAccountingPeriodId:id(8)}),error=>error.code==='AI_BANK_DUPLICATE_PAYMENT_SOURCE_INVALID');
});

test('fails closed for unsigned, unadmitted, malformed, repeated-identity, or oversized evidence',()=>{
  for(const changed of [{signature_verified:false},{source_admission_status:'STAGING'},{source_payload_hash:'bad'},{external_bank_line_id:''}])assert.throws(()=>detectDuplicateBankPayments([row(1,changed)],{currentAccountingPeriodId:id(8)}),error=>error.code==='AI_BANK_DUPLICATE_PAYMENT_SOURCE_INVALID');
  assert.throws(()=>detectDuplicateBankPayments([row(1),row(1)],{currentAccountingPeriodId:id(8)}),error=>error.code==='AI_BANK_DUPLICATE_PAYMENT_SOURCE_INVALID');
  assert.throws(()=>detectDuplicateBankPayments(Array.from({length:501},(_,index)=>row(index+1)),{currentAccountingPeriodId:id(8)}),error=>error.code==='AI_BANK_DUPLICATE_PAYMENT_SCOPE_INVALID');
});
