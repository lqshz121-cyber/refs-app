import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('invoice accrual proposal requires exact retained ACCRUAL_REVIEW evidence',async()=>{
  const up=await read('../db/migrations/196_ai_invoice_accrual_proposal.sql');
  for(const token of ['CREATE TABLE ai_invoice_accrual_proposal',"evidence.classification<>'ACCRUAL_REVIEW'","evidence.status<>'REVIEW_REQUIRED'","evidence.rule_id<>'AI_PRIOR_SERVICE_ACCRUAL_REVIEW_V1'",'source.payload_hash<>evidence.source_payload_hash','source_line.amount','member trace does not exactly match'])assert.ok(up.includes(token),`missing ${token}`);
  assert.match(up,/expense_account_code<>liability_account_code/);
  assert.match(up,/reversal date must follow the accrual period/);
});

test('proposal is actor-idempotent, append-only, audited, and has zero accounting authority',async()=>{
  const up=await read('../db/migrations/196_ai_invoice_accrual_proposal.sql');
  for(const token of ['AI_INVOICE_ACCRUAL_PROPOSAL_V1','AI_INVOICE_ACCRUAL_PROPOSED','idem.actor_id IS DISTINCT FROM actor','reject_mutation','INSERT INTO audit_event','INSERT INTO outbox_event',"'can_create_draft',false","'can_review',false","'can_approve',false","'can_post',false"])assert.ok(up.includes(token),`missing ${token}`);
  assert.doesNotMatch(up,/INSERT INTO (staging_item|journal_entry|journal_line|ledger_line)/i);
});

test('read is scoped and rollback preserves retained proposals',async()=>{
  const up=await read('../db/migrations/196_ai_invoice_accrual_proposal.sql'),down=await read('../db/migrations/down/196_ai_invoice_accrual_proposal.sql');
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.ACCRUAL\.VIEW'\)/);
  assert.match(up,/p_limit<1 OR p_limit>100/);
  assert.match(down,/IF EXISTS\(SELECT 1 FROM ai_invoice_accrual_proposal\)/);
  assert.match(down,/ERRCODE='55006'/);
});

test('repository computes the canonical hash before proposing and exposes only the scoped reader',async()=>{
  const calls=[],kernel=new PostgresAccountingKernel({},{sessionProvider:async()=>({})});
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1,rows:[sql.includes('_hash(')?{request_hash:`sha256:${'a'.repeat(64)}`} : sql.includes('refs_propose_')?{result:{status:'PROPOSED'}}:{ai_invoice_accrual_proposal_id:'proposal'}]};}});
  const input={tenantId:'tenant',entityId:'entity',classificationEvidenceId:'evidence',classificationHash:`sha256:${'b'.repeat(64)}`,accountingPeriodId:'period',expenseAccountCode:'610100',liabilityAccountCode:'211000',memberTrace:{project_ref:null,property_ref:null,allocation_basis:'ENTITY_ONLY'},reversalDecision:'REVERSE_NEXT_OPEN_PERIOD',reversalDate:'2026-09-01',reason:'Controller review required for the prior service invoice.',idempotencyKey:'idem'};
  assert.deepEqual(await kernel.proposeAiInvoiceAccrual(input),{status:'PROPOSED'});
  assert.deepEqual(await kernel.listAiInvoiceAccrualProposals({tenantId:'tenant',entityId:'entity',limit:25}),[{ai_invoice_accrual_proposal_id:'proposal'}]);
  assert.match(calls[0].sql,/refs_propose_ai_invoice_accrual_hash/);assert.match(calls[1].sql,/refs_propose_ai_invoice_accrual/);assert.match(calls[2].sql,/refs_read_ai_invoice_accrual_proposals/);
  assert.equal(calls[1].args.at(-2),'idem');assert.match(calls[1].args.at(-1),/^sha256:/);
});
