import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAccountingApi} from '../api/accounting-http.mjs';

const migration=readFileSync(new URL('../db/migrations/285_ai_bank_duplicate_payment_lifecycle.sql',import.meta.url),'utf8');
const down=readFileSync(new URL('../db/migrations/down/285_ai_bank_duplicate_payment_lifecycle.sql',import.meta.url),'utf8');
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=`sha256:${'a'.repeat(64)}`;

test('duplicate-payment lifecycle is append-only and all current-risk consumers share its projection',()=>{
  assert.match(migration,/CREATE TABLE ai_bank_duplicate_payment_lifecycle/);
  assert.match(migration,/DUPLICATE_CONFIRMED.*VALID_DISTINCT_PAYMENTS.*SUPERSEDED_BY_NEW_EVIDENCE/s);
  assert.match(migration,/CREATE VIEW ai_bank_duplicate_payment_current_finding/);
  assert.match(migration,/refs_assign_ai_finding_action/);
  assert.match(migration,/refs_read_ai_finding_assignment_candidates/);
  assert.match(migration,/refs_read_ai_accounting_analysis_summary/);
  assert.match(migration,/refs_read_ai_bank_duplicate_payment_findings/);
  assert.match(migration,/Bank duplicate-payment findings require structured resolution/);
  assert.match(down,/Cannot roll back retained duplicate-payment lifecycle evidence/);
  for(const forbidden of [/UPDATE\s+ai_bank_duplicate_payment_finding/i,/DELETE\s+FROM\s+ai_bank_duplicate_payment_finding/i,/INSERT\s+INTO\s+journal_entry/i,/INSERT\s+INTO\s+ledger_line/i])assert.doesNotMatch(migration,forbidden);
});

test('HTTP structured resolution requires the complete human conclusion and remains action-free',async()=>{
  let seen;const entityId=id(1),findingId=id(2),actionId=id(3),tenantId=id(4);
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller'}),kernelFactory:async()=>({resolveAiBankDuplicatePayment:async input=>(seen=input,{schema_version:'AI_BANK_DUPLICATE_PAYMENT_RESOLUTION_V1',status:'RESOLVED',conclusion:input.conclusion,can_create_draft:false,can_review:false,can_approve:false,can_post:false})})});
  const body={aiFindingActionId:actionId,findingId,findingHash:hash,conclusion:'VALID_DISTINCT_PAYMENTS',vendorIdentity:'Vendor identity verified',invoiceSupport:'Both invoices inspected and distinct',paymentApproval:'Both approvals independently retained',bankMemo:'Bank memos identify distinct obligations',resolutionReason:'Controller confirmed these are two valid payments.'};
  const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/findings/bank-duplicate-payment/resolutions`,headers:{'idempotency-key':'duplicate-resolution-001','if-match':'"0"'},body});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.equal(seen.findingId,findingId);assert.equal(seen.conclusion,'VALID_DISTINCT_PAYMENTS');assert.equal(seen.humanEvidence.resolution_reason,body.resolutionReason);assert.equal(response.body.data.can_post,false);
  const invalid=await api({method:'POST',url:`/api/v1/entities/${entityId}/ai/findings/bank-duplicate-payment/resolutions`,headers:{'idempotency-key':'duplicate-resolution-002','if-match':'"0"'},body:{...body,conclusion:'MAYBE'}});assert.equal(invalid.status,400);
});
