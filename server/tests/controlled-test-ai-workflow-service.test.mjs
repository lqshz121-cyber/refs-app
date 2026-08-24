import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlledTestAiWorkflowService,CONTROLLED_TEST_AI_GRANT_BUNDLES,reconcileControlledTestAiWorkflowActorGrants} from '../runtime/controlled-test-ai-workflow-service.mjs';

const ids={tenant:'11111111-1111-4111-8111-111111111111',entity:'22222222-2222-4222-8222-222222222222',period:'33333333-3333-4333-8333-333333333333',parent:'44444444-4444-4444-8444-444444444444',source:'55555555-5555-4555-8555-555555555555',line:'66666666-6666-4666-8666-666666666666',attachment:'77777777-7777-4777-8777-777777777777',controlled:'88888888-8888-4888-8888-888888888888',schedule:'99999999-9999-4999-8999-999999999999',scheduleLine:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',journal:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',batch:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
const hash=`sha256:${'a'.repeat(64)}`;
const actors={sourceMaker:'test-ai-source',proposer:'test-ai-proposer',draftMaker:'test-ai-draft',submitter:'test-ai-submit',reviewer:'test-ai-review',approver:'test-ai-approve',poster:'test-ai-post'};
const scope={tenantId:ids.tenant,entityId:ids.entity,callerActorId:'authenticated-test-user',actors,prepaidAccountCode:'141500',expenseAccountCode:'610000',grantValidUntil:'2026-08-24T00:00:00.000Z'};

test('controlled test AI runner preserves source lineage and uses distinct standard workflow actors',async()=>{
  const calls=[];
  const methods={
    deriveControlledTestAiSource:async input=>{calls.push(['derive',input]);return {attachment_id:ids.attachment,controlled_test_ai_source_id:ids.controlled,idempotent:false,parent_source_document_id:ids.parent,provenance_mode:'UNSIGNED_TEST_ONLY',source_document_id:ids.source,source_document_line_id:ids.line,source_payload_hash:hash,status:'READY_FOR_DRAFT',test_only:true};},
    recordAiAmortizationCoverageEvidence:async input=>{calls.push(['coverage',input]);return {};},
    proposeAiAmortizationSchedule:async input=>{calls.push(['proposal',input]);return {ai_amortization_schedule_id:ids.schedule,proposal_hash:hash};},
    listAiAmortizationSchedules:async()=>[{ai_amortization_schedule_id:ids.schedule,source_document_id:ids.source,proposal_hash:hash,eligible_source_attachment_ids:[ids.attachment],schedule_lines:[{ai_amortization_schedule_line_id:ids.scheduleLine,amortization_month:'2026-08-01'}]}],
    createAiAmortizationDraft:async input=>{calls.push(['draft',input]);return {status:'DRAFT',journal_type:'MANUAL',journal_entry_id:ids.journal,source_document_id:ids.source};},
    transitionJournal:async input=>{calls.push([input.action,input]);return {status:{SUBMIT:'PENDING_REVIEW',REVIEW:'PENDING_APPROVAL',APPROVE:'APPROVED'}[input.action]};},
    postJournal:async input=>{calls.push(['POST',input]);return {journal_entry_id:ids.journal,posting_batch_id:ids.batch,idempotent:false};}
  };
  const service=createControlledTestAiWorkflowService({scope,kernelForActor:actor=>Object.fromEntries(Object.entries(methods).map(([name,fn])=>[name,async input=>{calls.push(['actor',actor,name]);return fn(input);}] ))});
  const result=await service.run({tenantId:ids.tenant,entityId:ids.entity,periodId:ids.period,parentSourceDocumentId:ids.parent,coverageStart:'2026-08-01',coverageEnd:'2026-08-31',reason:'Run isolated accounting workflow',idempotencyKey:'controlled-test-001',initiatedBy:'authenticated-test-user'});
  assert.deepEqual(result,{status:'CONTROLLED_TEST_AI_WORKFLOW_POSTED',test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',idempotent:false,parent_source_document_id:ids.parent,source_document_id:ids.source,ai_amortization_schedule_id:ids.schedule,journal_entry_id:ids.journal,posting_batch_id:ids.batch});
  for(const actor of Object.values(actors))assert.equal(calls.some(row=>row[0]==='actor'&&row[1]===actor),true);
  const proposal=calls.find(row=>row[0]==='proposal')[1];assert.equal(proposal.sourceDocumentId,ids.source);assert.match(proposal.reason,/^UNSIGNED TEST ONLY/);
});

test('controlled test AI runner reconciles the legacy proposal receipt from the authoritative schedule only',async()=>{
  const methods={
    deriveControlledTestAiSource:async()=>({attachment_id:ids.attachment,controlled_test_ai_source_id:ids.controlled,idempotent:true,parent_source_document_id:ids.parent,provenance_mode:'UNSIGNED_TEST_ONLY',source_document_id:ids.source,source_document_line_id:ids.line,source_payload_hash:hash,status:'READY_FOR_DRAFT',test_only:true}),
    recordAiAmortizationCoverageEvidence:async()=>({}),
    proposeAiAmortizationSchedule:async()=>({ai_amortization_schedule_id:ids.schedule,status:'PROPOSED',idempotent:true}),
    listAiAmortizationSchedules:async()=>[{ai_amortization_schedule_id:ids.schedule,source_document_id:ids.source,proposal_hash:hash,eligible_source_attachment_ids:[ids.attachment],schedule_lines:[{ai_amortization_schedule_line_id:ids.scheduleLine,amortization_month:'2026-08-01'}]}],
    createAiAmortizationDraft:async input=>({status:'DRAFT',journal_type:'MANUAL',journal_entry_id:ids.journal,source_document_id:ids.source,expectedProposalHash:input.expectedProposalHash}),
    transitionJournal:async input=>({status:{SUBMIT:'PENDING_REVIEW',REVIEW:'PENDING_APPROVAL',APPROVE:'APPROVED'}[input.action]}),
    postJournal:async()=>({journal_entry_id:ids.journal,posting_batch_id:ids.batch,idempotent:true})
  };
  const service=createControlledTestAiWorkflowService({scope,kernelForActor:()=>methods});
  const result=await service.run({tenantId:ids.tenant,entityId:ids.entity,periodId:ids.period,parentSourceDocumentId:ids.parent,coverageStart:'2026-08-01',coverageEnd:'2026-08-31',reason:'Resume legacy proposal receipt',idempotencyKey:'legacy-proposal-receipt-001',initiatedBy:'authenticated-test-user'});
  assert.equal(result.status,'CONTROLLED_TEST_AI_WORKFLOW_POSTED');
});

test('controlled test AI runner rejects a proposal receipt that conflicts with the authoritative schedule',async()=>{
  const otherHash=`sha256:${'b'.repeat(64)}`;
  const methods={
    deriveControlledTestAiSource:async()=>({attachment_id:ids.attachment,controlled_test_ai_source_id:ids.controlled,idempotent:true,parent_source_document_id:ids.parent,provenance_mode:'UNSIGNED_TEST_ONLY',source_document_id:ids.source,source_document_line_id:ids.line,source_payload_hash:hash,status:'READY_FOR_DRAFT',test_only:true}),
    recordAiAmortizationCoverageEvidence:async()=>({}),
    proposeAiAmortizationSchedule:async()=>({ai_amortization_schedule_id:ids.schedule,proposal_hash:otherHash}),
    listAiAmortizationSchedules:async()=>[{ai_amortization_schedule_id:ids.schedule,source_document_id:ids.source,proposal_hash:hash,eligible_source_attachment_ids:[ids.attachment],schedule_lines:[{ai_amortization_schedule_line_id:ids.scheduleLine,amortization_month:'2026-08-01'}]}],
    createAiAmortizationDraft:async()=>{throw new Error('must not draft');},transitionJournal:async()=>{},postJournal:async()=>{}
  };
  const service=createControlledTestAiWorkflowService({scope,kernelForActor:()=>methods});
  await assert.rejects(()=>service.run({tenantId:ids.tenant,entityId:ids.entity,periodId:ids.period,parentSourceDocumentId:ids.parent,coverageStart:'2026-08-01',coverageEnd:'2026-08-31',reason:'Reject conflicting proposal receipt',idempotencyKey:'conflicting-proposal-001',initiatedBy:'authenticated-test-user'}),error=>error.code==='CONTROLLED_TEST_AI_PROPOSAL_INVALID');
});

test('controlled test AI grant reconciliation gives each static actor only its frozen permission bundle',async()=>{
  const seen=[];const result=await reconcileControlledTestAiWorkflowActorGrants({scope,grantSync:{currentVersion:async()=>2,reconcile:async input=>{seen.push(input);return {permissions:input.permissions,version:3,idempotent:false};}}});
  assert.equal(seen.length,7);for(const [role,permissions] of Object.entries(CONTROLLED_TEST_AI_GRANT_BUNDLES))assert.deepEqual(seen.find(row=>row.actorId===actors[role]).permissions,[...permissions]);
  assert.deepEqual(seen.map(row=>row.authorityClass),['SERVICE','PREPARE','DRAFT','SUBMIT','REVIEW','APPROVE','POST']);assert.ok(seen.every(row=>row.validUntil===scope.grantValidUntil));
  assert.ok(seen.every(row=>row.expectedVersion===2&&row.idempotencyKey.endsWith('-v278-2')));
  assert.equal(Object.keys(result).length,7);
});

test('controlled test AI runner rejects a caller or scope outside its fixed staging boundary before any kernel call',async()=>{
  let calls=0;const service=createControlledTestAiWorkflowService({scope,kernelForActor:()=>{calls++;return {};}});
  await assert.rejects(()=>service.run({tenantId:ids.tenant,entityId:ids.entity,periodId:ids.period,parentSourceDocumentId:ids.parent,coverageStart:'2026-08-01',coverageEnd:'2026-08-31',reason:'Run isolated accounting workflow',idempotencyKey:'controlled-test-001',initiatedBy:'another-user'}),error=>error.code==='CONTROLLED_TEST_AI_SCOPE_DENIED');
  assert.equal(calls,0);
});

test('every durable stage failure returns PARTIAL and same-key replay resumes through POSTED',async()=>{
  const cases=[['recordAiAmortizationCoverageEvidence','SOURCE_DERIVED'],['proposeAiAmortizationSchedule','COVERAGE_RECORDED'],['createAiAmortizationDraft','PROPOSAL_RECORDED'],['SUBMIT','DRAFT_CREATED'],['REVIEW','SUBMITTED'],['APPROVE','REVIEWED'],['postJournal','APPROVED']];
  for(const [failurePoint,completedStage] of cases){
    let failed=false;const keys=[];
    const maybeFail=(point,input)=>{keys.push(input.idempotencyKey);if(point===failurePoint&&!failed){failed=true;throw new Error('injected stage interruption');}};
    const methods={
      deriveControlledTestAiSource:async input=>(keys.push(input.idempotencyKey),{attachment_id:ids.attachment,controlled_test_ai_source_id:ids.controlled,idempotent:keys.filter(key=>key===input.idempotencyKey).length>1,parent_source_document_id:ids.parent,provenance_mode:'UNSIGNED_TEST_ONLY',source_document_id:ids.source,source_document_line_id:ids.line,source_payload_hash:hash,status:'READY_FOR_DRAFT',test_only:true}),
      recordAiAmortizationCoverageEvidence:async input=>(maybeFail('recordAiAmortizationCoverageEvidence',input),{}),
      proposeAiAmortizationSchedule:async input=>(maybeFail('proposeAiAmortizationSchedule',input),{ai_amortization_schedule_id:ids.schedule,proposal_hash:hash}),
      listAiAmortizationSchedules:async()=>[{ai_amortization_schedule_id:ids.schedule,source_document_id:ids.source,proposal_hash:hash,eligible_source_attachment_ids:[ids.attachment],schedule_lines:[{ai_amortization_schedule_line_id:ids.scheduleLine,amortization_month:'2026-08-01'}]}],
      createAiAmortizationDraft:async input=>(maybeFail('createAiAmortizationDraft',input),{status:'DRAFT',journal_type:'MANUAL',journal_entry_id:ids.journal,source_document_id:ids.source}),
      transitionJournal:async input=>(maybeFail(input.action,input),{status:{SUBMIT:'PENDING_REVIEW',REVIEW:'PENDING_APPROVAL',APPROVE:'APPROVED'}[input.action]}),
      postJournal:async input=>(maybeFail('postJournal',input),{journal_entry_id:ids.journal,posting_batch_id:ids.batch,idempotent:keys.filter(key=>key===input.idempotencyKey).length>1})
    };
    const service=createControlledTestAiWorkflowService({scope,kernelForActor:()=>methods}),command={tenantId:ids.tenant,entityId:ids.entity,periodId:ids.period,parentSourceDocumentId:ids.parent,coverageStart:'2026-08-01',coverageEnd:'2026-08-31',reason:'Resume isolated accounting workflow',idempotencyKey:`resume-${failurePoint}-001`,initiatedBy:'authenticated-test-user'};
    const partial=await service.run(command);assert.equal(partial.status,'CONTROLLED_TEST_AI_WORKFLOW_PARTIAL');assert.equal(partial.completed_stage,completedStage);assert.equal(partial.retryable,true);assert.equal(partial.idempotency_key,command.idempotencyKey);
    const posted=await service.run(command);assert.equal(posted.status,'CONTROLLED_TEST_AI_WORKFLOW_POSTED');assert.equal(posted.journal_entry_id,ids.journal);
    for(const suffix of [':source',':coverage',':proposal',':draft',':submit',':review',':approve',':post'])assert.ok(keys.filter(key=>key===`${command.idempotencyKey}${suffix}`).length<=2);
  }
});

test('a lost response after Post commit replays the same stage key without a second journal or posting',async()=>{
  let postCalls=0,journalWrites=0,postingWrites=0,responseLost=true;
  const methods={
    deriveControlledTestAiSource:async()=>({attachment_id:ids.attachment,controlled_test_ai_source_id:ids.controlled,idempotent:false,parent_source_document_id:ids.parent,provenance_mode:'UNSIGNED_TEST_ONLY',source_document_id:ids.source,source_document_line_id:ids.line,source_payload_hash:hash,status:'READY_FOR_DRAFT',test_only:true}),
    recordAiAmortizationCoverageEvidence:async()=>({}),proposeAiAmortizationSchedule:async()=>({ai_amortization_schedule_id:ids.schedule,proposal_hash:hash}),
    listAiAmortizationSchedules:async()=>[{ai_amortization_schedule_id:ids.schedule,source_document_id:ids.source,proposal_hash:hash,eligible_source_attachment_ids:[ids.attachment],schedule_lines:[{ai_amortization_schedule_line_id:ids.scheduleLine,amortization_month:'2026-08-01'}]}],
    createAiAmortizationDraft:async()=>{if(journalWrites===0)journalWrites++;return {status:'DRAFT',journal_type:'MANUAL',journal_entry_id:ids.journal,source_document_id:ids.source};},
    transitionJournal:async input=>({status:{SUBMIT:'PENDING_REVIEW',REVIEW:'PENDING_APPROVAL',APPROVE:'APPROVED'}[input.action]}),
    postJournal:async()=>{postCalls++;if(postingWrites===0)postingWrites++;if(responseLost){responseLost=false;throw new Error('response lost after database commit');}return {journal_entry_id:ids.journal,posting_batch_id:ids.batch,idempotent:true};}
  };
  const service=createControlledTestAiWorkflowService({scope,kernelForActor:()=>methods}),command={tenantId:ids.tenant,entityId:ids.entity,periodId:ids.period,parentSourceDocumentId:ids.parent,coverageStart:'2026-08-01',coverageEnd:'2026-08-31',reason:'Recover a lost Post response',idempotencyKey:'lost-post-response-001',initiatedBy:'authenticated-test-user'};
  const partial=await service.run(command);assert.equal(partial.completed_stage,'APPROVED');
  const replay=await service.run(command);assert.equal(replay.status,'CONTROLLED_TEST_AI_WORKFLOW_POSTED');assert.equal(replay.idempotent,true);
  assert.equal(postCalls,2);assert.equal(journalWrites,1);assert.equal(postingWrites,1);
});
