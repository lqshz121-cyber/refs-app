import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlledTestBankWorkflowService} from '../runtime/controlled-test-bank-workflow-service.mjs';

const uuid=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=uuid(1),entityId=uuid(2),periodId=uuid(3),reconciliationId=uuid(4),attachmentId=uuid(5),matchId=uuid(6),journalId=uuid(7),snapshotId=uuid(8);
const actors={importer:'bank-importer',maker:'bank-maker',submitter:'bank-submitter',reviewer:'bank-reviewer',approver:'bank-approver',poster:'bank-poster'};
const scope={tenantId,entityId,companyCode:'WBPA',bankAccountRef:'WBS_TEST_BANK',cashAccountCode:'111000',offsetAccountCode:'610000',actors};
const input={tenantId,entityId,periodId,reconciliationId,reason:'Complete the isolated WBS Bank test workflow',idempotencyKey:'controlled-bank-run-001'};

function harness({bankAccountRef='WBS_TEST_BANK',transactionDate='2026-07-10',statementEndingDate='2026-07-31'}={}){
  const calls=[];let status='DRAFT',version=0;
  const rows=[
    {reconciliation_version:0,bank_source_id:uuid(11),bank_version:0,bank_account_ref:bankAccountRef,transaction_date:transactionDate,currency:'USD',amount:'-25.0000',bank_match_id:null,match_status:null,clearance_state:'NOT_CLEARED',adjustment_journal_entry_id:null,adjustment_journal_version:null,adjustment_journal_status:null,adjustment_clearance_eligible:false},
    {reconciliation_version:0,bank_source_id:uuid(12),bank_version:0,bank_account_ref:bankAccountRef,transaction_date:transactionDate,currency:'USD',amount:'40.0000',bank_match_id:null,match_status:null,clearance_state:'NOT_CLEARED',adjustment_journal_entry_id:null,adjustment_journal_version:null,adjustment_journal_status:null,adjustment_clearance_eligible:false}
  ];
  const refresh=()=>rows.forEach(row=>{row.reconciliation_version=version;});
  const methods={
    async listReconciliationScopes(){return [{reconciliation_id:reconciliationId,bank_account_ref:bankAccountRef,statement_ending_date:statementEndingDate,status,version}];},
    async listReconciliationWorksheet(){return rows.map(row=>({...row}));},
    async getReconciliationWorksheetItem({bankSourceId}){const row=rows.find(value=>value.bank_source_id===bankSourceId);return row?{...row}:null;},
    async listBankMatchCandidates({bankSourceId}){return bankSourceId===rows[0].bank_source_id?[{payment_occurrence_id:uuid(20),occurrence_version:1}]:[];},
    async createBankPaymentMatch(args){calls.push(['match',args]);rows[0].bank_match_id=matchId;rows[0].match_status='ACTIVE';return {bank_match_id:matchId,status:'ACTIVE',idempotent:false};},
    async listVerifiedCleanAttachmentIds(){return [attachmentId];},
    async createReconciliationAdjustmentDraft(args){calls.push(['draft',args]);version++;rows[1].adjustment_journal_entry_id=journalId;rows[1].adjustment_journal_version=0;rows[1].adjustment_journal_status='DRAFT';refresh();return {reconciliation_revision:version,journal_entry_id:journalId,journal_status:'DRAFT'};},
    async transitionJournal(args){calls.push([args.action.toLowerCase(),args]);const next={SUBMIT:['PENDING_REVIEW',1],REVIEW:['PENDING_APPROVAL',2],APPROVE:['APPROVED',3]}[args.action];rows[1].adjustment_journal_status=next[0];rows[1].adjustment_journal_version=next[1];return {status:next[0],revision:next[1]};},
    async postJournal(args){calls.push(['post',args]);rows[1].adjustment_journal_status='POSTED';rows[1].adjustment_journal_version=4;rows[1].adjustment_clearance_eligible=true;return {journal_entry_id:journalId,posting_batch_id:uuid(21),revision:4,idempotent:false};},
    async setReconciliationClearance(args){calls.push(['clear-match',args]);version++;rows[0].clearance_state='CLEARED';refresh();return {revision:version,state:'CLEARED'};},
    async setReconciliationAdjustmentClearance(args){calls.push(['clear-adjustment',args]);version++;rows[1].clearance_state='CLEARED';refresh();return {revision:version,state:'CLEARED'};},
    async transitionReconciliation(args){calls.push([args.action.toLowerCase(),args]);version++;status={REVIEW:'IN_REVIEW',SIGN_OFF:'RECONCILED',REOPEN:'REOPENED'}[args.action];refresh();return {status,revision:version,snapshot_id:args.action==='SIGN_OFF'?snapshotId:null,snapshot_hash:args.action==='SIGN_OFF'?`sha256:${'a'.repeat(64)}`:null,idempotent:false};},
    async getSignedReconciliationSnapshot(){return [{reconciliation_snapshot_id:snapshotId,snapshot_hash:`sha256:${'a'.repeat(64)}`,snapshot_body:{items:[]}}];}
  };
  const service=createControlledTestBankWorkflowService({scope:{...scope,bankAccountRef},authorize:async args=>calls.push(['authorize',args]),kernelForActor:actor=>new Proxy({}, {get:(_,method)=>typeof methods[method]==='function'?async args=>(calls.push(['actor',actor,method]),methods[method](args)):undefined})});
  return {service,calls,rows,getStatus:()=>status};
}

test('prefers exact Match, posts adjustment with distinct actors, clears, signs off, reopens, and replays',async()=>{
  const {service,calls,rows,getStatus}=harness();const result=await service.run(input);
  assert.deepEqual(result,{status:'CONTROLLED_TEST_BANK_WORKFLOW_REOPENED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,reconciliation_id:reconciliationId,processed_count:2,matched_count:1,adjusted_count:1,cleared_count:2,journal_entry_ids:[journalId],revision:6,snapshot_id:snapshotId,snapshot_hash:`sha256:${'a'.repeat(64)}`});
  assert.equal(getStatus(),'REOPENED');assert.ok(rows.every(row=>row.clearance_state==='CLEARED'));
  const actorFor=method=>calls.find(call=>call[0]==='actor'&&call[2]===method)?.[1];
  assert.equal(actorFor('createBankPaymentMatch'),actors.importer);assert.equal(actorFor('createReconciliationAdjustmentDraft'),actors.maker);
  assert.ok(calls.some(call=>call[0]==='actor'&&call[1]===actors.reviewer&&call[2]==='transitionReconciliation'));
  assert.ok(calls.some(call=>call[0]==='actor'&&call[1]===actors.approver&&call[2]==='transitionReconciliation'));
  assert.ok(calls.some(call=>call[0]==='actor'&&call[1]===actors.poster&&call[2]==='transitionReconciliation'));
  const draft=calls.find(call=>call[0]==='draft')[1];assert.equal(draft.description.startsWith('UNSIGNED TEST ONLY'),true);assert.deepEqual(draft.attachmentIds,[attachmentId]);
  assert.deepEqual(draft.lines.map(line=>[line.account_code,line.debit_amount,line.credit_amount,line.member_ref]),[['111000','40.0000','0.0000','WBS_TEST_BANK'],['610000','0.0000','40.0000',null]]);
  const replay=await service.run(input);assert.equal(replay.idempotent,true);assert.equal(replay.revision,6);
});

test('rejects cross-scope selection and missing verified-clean evidence before adjustment mutation',async()=>{
  const first=harness();await assert.rejects(first.service.run({...input,entityId:uuid(99)}),error=>error.code==='CONTROLLED_TEST_BANK_SCOPE_DENIED');
  const methods={listReconciliationScopes:async()=>[{reconciliation_id:reconciliationId,bank_account_ref:'WBS_TEST_BANK',status:'DRAFT',version:0}],listReconciliationWorksheet:async()=>[{reconciliation_version:0,bank_source_id:uuid(12),bank_version:0,bank_account_ref:'WBS_TEST_BANK',transaction_date:'2026-07-11',currency:'USD',amount:'40.0000',bank_match_id:null,match_status:null,clearance_state:'NOT_CLEARED',adjustment_journal_entry_id:null}],listBankMatchCandidates:async()=>[],listVerifiedCleanAttachmentIds:async()=>[]};
  const fallback=()=>async()=>({});const service=createControlledTestBankWorkflowService({scope,authorize:async()=>{},kernelForActor:()=>new Proxy({}, {get:(_,method)=>methods[method]||fallback(method)})});
  await assert.rejects(service.run(input),error=>error.code==='CONTROLLED_TEST_BANK_EVIDENCE_REQUIRED');
});

test('processes a bounded chunk, returns PARTIAL, and advances with the same root key until final reopen',async()=>{
  const {service,calls}=harness();
  const partial=await service.run({...input,maxItems:1});
  assert.deepEqual(partial,{status:'CONTROLLED_TEST_BANK_WORKFLOW_PARTIAL',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,reconciliation_id:reconciliationId,total_count:2,processed_count:1,matched_count:1,adjusted_count:0,cleared_count:1,remaining_count:1,revision:1});
  const completed=await service.run({...input,maxItems:1});
  assert.equal(completed.status,'CONTROLLED_TEST_BANK_WORKFLOW_REOPENED');assert.equal(completed.processed_count,2);assert.equal(completed.revision,6);
  assert.equal(calls.filter(call=>call[0]==='match').length,1);assert.equal(calls.filter(call=>call[0]==='draft').length,1);
  assert.ok(calls.filter(call=>call[0]==='actor'&&call[2]==='getReconciliationWorksheetItem').length>=3);
});

test('runs one to six explicit monthly period/reconciliation scopes and closes aggregate totals',async()=>{
  const {service}=harness();const result=await service.runRange({tenantId,entityId,scopes:[{periodId,reconciliationId}],reason:input.reason,idempotencyKey:'controlled-bank-range-001'});
  assert.deepEqual({status:result.status,scope_count:result.scope_count,processed_count:result.processed_count,matched_count:result.matched_count,adjusted_count:result.adjusted_count,cleared_count:result.cleared_count,idempotent:result.idempotent},
    {status:'CONTROLLED_TEST_BANK_RANGE_WORKFLOW_REOPENED',scope_count:1,processed_count:2,matched_count:1,adjusted_count:1,cleared_count:2,idempotent:false});
  assert.equal(result.results.length,1);assert.equal(result.results[0].reconciliation_id,reconciliationId);
  await assert.rejects(service.runRange({tenantId,entityId,scopes:Array.from({length:7},(_,index)=>({periodId,reconciliationId:uuid(index+30)})),reason:input.reason,idempotencyKey:'controlled-bank-range-002'}),error=>error.code==='CONTROLLED_TEST_BANK_SELECTION_INVALID');
});

test('feeds migration179 monthly reconciliation scopes directly into migration180 range workflow',async()=>{
  const {service,calls}=harness({bankAccountRef:'WBS_TEST_BANK_2026_01',transactionDate:'2026-01-15',statementEndingDate:'2026-01-31'});
  const import179={bank:{reconciliations:[{bank_account_ref:'WBS_TEST_BANK_2026_01',period_code:'2026-01',period_id:periodId,reconciliation_id:reconciliationId,transaction_count:2}]}};
  const scopes=import179.bank.reconciliations.map(row=>({periodId:row.period_id,reconciliationId:row.reconciliation_id}));
  const result=await service.runRange({tenantId,entityId,scopes,reason:input.reason,idempotencyKey:'controlled-bank-range-monthly-001'});
  assert.equal(result.status,'CONTROLLED_TEST_BANK_RANGE_WORKFLOW_REOPENED');assert.equal(result.processed_count,2);
  assert.equal(calls.find(call=>call[0]==='draft')[1].lines[0].member_ref,'WBS_TEST_BANK_2026_01');
  const wrongMonth=harness({bankAccountRef:'WBS_TEST_BANK_2026_01',transactionDate:'2026-01-15',statementEndingDate:'2026-02-28'});
  await assert.rejects(wrongMonth.service.runRange({tenantId,entityId,scopes,reason:input.reason,idempotencyKey:'controlled-bank-range-monthly-002'}),error=>error.code==='CONTROLLED_TEST_BANK_SCOPE_DENIED');
});

test('public result contract accepts large monthly evidence up to ten thousand',async()=>{
  const ids=Array.from({length:61},(_,index)=>uuid(index+100));
  const result={status:'CONTROLLED_TEST_BANK_WORKFLOW_REOPENED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,reconciliation_id:reconciliationId,processed_count:61,matched_count:0,adjusted_count:61,cleared_count:61,journal_entry_ids:ids,revision:70,snapshot_id:snapshotId,snapshot_hash:`sha256:${'a'.repeat(64)}`};
  const {assertControlledTestBankWorkflowResult}=await import('../runtime/controlled-test-bank-workflow-service.mjs');
  assert.equal(assertControlledTestBankWorkflowResult(result),result);
});
