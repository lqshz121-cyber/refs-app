import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsTestImportService,reconcileWbsTestImportActorGrants,WBS_TEST_IMPORT_GRANT_BUNDLES} from '../runtime/wbs-test-import-service.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='fe5a2a7c-3a26-4dd9-bdd8-6e46ba784231';
const uuid=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const actors={importer:'wbs-test-importer',maker:'wbs-test-maker',submitter:'wbs-test-submitter',reviewer:'wbs-test-reviewer',approver:'wbs-test-approver',poster:'wbs-test-poster'};
const scope={tenantId,entityId,companyCode:'WBPA',actors};
const observation=(rows=[{source_record_hash:`sha256:${'a'.repeat(64)}`,currency:'USD',accounting_date:'2026-08-11',amount:'12.3000',status:'CLEAR'}])=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_payables',environment:'PRODUCTION',entity_id:entityId,captured_at:'2026-08-18T00:00:00.000Z',provider_content_sha256:'b'.repeat(64),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']},record_count:rows.length,rows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:`sha256:${'c'.repeat(64)}`});
const input={tenantId,entityId,periodId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',limit:10,idempotencyKey:'wbs-test-import-0001'};

function harness({rows,mutateDraft,mutatePost,mutateFinalize}={}){
  const calls=[],kernels={};
  for(const [role,actor] of Object.entries(actors))kernels[actor]={
    async createWbsTestPayableDraft(args){calls.push([role,'draft',args]);return mutateDraft?.(args)||{business_document_id:uuid(1),journal_entry_id:uuid(2),source_document_id:uuid(3),attachment_id:uuid(4),status:'DRAFT',revision:0,idempotent:false,test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY'};},
    async transitionJournal(args){calls.push([role,args.action,args]);return {status:{SUBMIT:'PENDING_REVIEW',REVIEW:'PENDING_APPROVAL',APPROVE:'APPROVED'}[args.action],idempotent:false};},
    async postJournal(args){calls.push([role,'POST',args]);return mutatePost?.(args)||{journal_entry_id:uuid(2),posting_batch_id:uuid(5),idempotent:false};},
    async finalizeWbsTestImportSource(args){calls.push([role,'finalize',args]);return mutateFinalize?.(args)||{status:'POSTED',test_only:true,idempotent:false};}
  };
  const pilotCalls=[],pilotService={async readObservation(args){pilotCalls.push(args);return observation(rows);}};
  return {calls,pilotCalls,service:createWbsTestImportService({pilotService,kernelForActor:actor=>kernels[actor],scope})};
}

test('imports one sanitized live Payable through six distinct actors and returns the exact closed success DTO',async()=>{
  const {service,calls,pilotCalls}=harness();const result=await service.importPayables(input);
  assert.deepEqual(result,{status:'WBS_TEST_PAYABLE_IMPORT_COMPLETE',imported_count:1,replayed_count:0,posted_count:1,failed_count:0,test_only:true});
  assert.deepEqual(pilotCalls,[{tenantId,entityId,tool:'list_payables',limit:10,company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-12-31'}]);
  assert.deepEqual(calls.map(([role,action])=>[role,action]),[['maker','draft'],['submitter','SUBMIT'],['reviewer','REVIEW'],['approver','APPROVE'],['poster','POST'],['importer','finalize']]);
  assert.deepEqual(calls.slice(1,5).map(([,action,args])=>[action,args.expectedRevision]),[['SUBMIT',0],['REVIEW',1],['APPROVE',2],['POST',3]]);
  assert.equal(calls[0][2].observation.status,'NOT_ADMITTED');assert.equal(calls[0][2].row.source_record_hash,`sha256:${'a'.repeat(64)}`);
  assert.equal(calls.at(-1)[2].sourceDocumentId,uuid(3));assert.equal(calls.at(-1)[2].journalEntryId,uuid(2));
});

test('retains a signed non-zero Provider Payable amount for the TEST_ONLY database boundary',async()=>{
  const signedRow={source_record_hash:`sha256:${'d'.repeat(64)}`,currency:'USD',accounting_date:'2026-08-11',amount:'-12.3000',status:'CLEAR'};
  const {service,calls}=harness({rows:[signedRow]});
  const result=await service.importPayables(input);
  assert.equal(result.status,'WBS_TEST_PAYABLE_IMPORT_COMPLETE');
  assert.equal(calls[0][2].row.amount,'-12.3000');
  assert.equal(calls[0][2].row.source_record_hash,signedRow.source_record_hash);
});

test('counts atomic Draft receipt replay while replaying the same role-bound workflow keys',async()=>{
  const {service,calls}=harness({mutateDraft:()=>({business_document_id:uuid(1),journal_entry_id:uuid(2),source_document_id:uuid(3),attachment_id:uuid(4),status:'DRAFT',revision:0,idempotent:true,test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY'})});
  const result=await service.importPayables(input);assert.deepEqual({imported:result.imported_count,replayed:result.replayed_count,posted:result.posted_count},{imported:0,replayed:1,posted:1});assert.ok(calls.every(([,action,args])=>action==='draft'||args.idempotencyKey.startsWith(`${input.idempotencyKey}:${'a'.repeat(24)}:`)));
});

test('same-key replay accepts the original workflow receipts after the journal is already POSTED',async()=>{
  const replayCalls=[],pilotService={async readObservation(){return observation();}},kernels={};
  for(const [role,actor] of Object.entries(actors))kernels[actor]={
    async createWbsTestPayableDraft(){return {business_document_id:uuid(1),journal_entry_id:uuid(2),source_document_id:uuid(3),attachment_id:uuid(4),status:'DRAFT',revision:0,idempotent:true,test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY'};},
    async transitionJournal(args){replayCalls.push([role,args.action]);return {status:{SUBMIT:'PENDING_REVIEW',REVIEW:'PENDING_APPROVAL',APPROVE:'APPROVED'}[args.action],idempotent:true};},
    async postJournal(){replayCalls.push(['poster','POST']);return {journal_entry_id:uuid(2),posting_batch_id:uuid(5),idempotent:true};},
    async finalizeWbsTestImportSource(){return {status:'POSTED',test_only:true,idempotent:true};}
  };
  const result=await createWbsTestImportService({pilotService,kernelForActor:actor=>kernels[actor],scope}).importPayables(input);
  assert.deepEqual({imported:result.imported_count,replayed:result.replayed_count,posted:result.posted_count},{imported:0,replayed:1,posted:1});assert.deepEqual(replayCalls,[['submitter','SUBMIT'],['reviewer','REVIEW'],['approver','APPROVE'],['poster','POST']]);
});

test('rejects disabled-quality scope, duplicate/empty/malformed observations, and non-distinct actors before accounting writes',async()=>{
  const {service,calls}=harness();
  await assert.rejects(service.importPayables({...input,entityId:uuid(99)}),error=>error.code==='WBS_TEST_IMPORT_SCOPE_DENIED');
  await assert.rejects(harness({rows:[]}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_EMPTY');
  const duplicate={source_record_hash:`sha256:${'a'.repeat(64)}`,currency:'USD',accounting_date:'2026-08-11',amount:'12.3000',status:'CLEAR'};
  await assert.rejects(harness({rows:[duplicate,duplicate]}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_ROW_INVALID');
  await assert.rejects(harness({rows:[{...duplicate,amount:'0.0000'}]}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_ROW_INVALID');
  assert.equal(calls.length,0);
  assert.throws(()=>createWbsTestImportService({pilotService:{readObservation:async()=>observation()},kernelForActor:()=>({}),scope:{...scope,actors:{...actors,reviewer:actors.maker}}}),error=>error.code==='WBS_TEST_IMPORT_CONFIG_INVALID');
});

test('fails closed on an unsafe Draft, workflow transition, or source finalization result',async()=>{
  await assert.rejects(harness({mutateDraft:()=>({status:'DRAFT',test_only:true})}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_DRAFT_INVALID');
  await assert.rejects(harness({mutatePost:()=>({status:'POSTED',idempotent:false})}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_WORKFLOW_INVALID');
  await assert.rejects(harness({mutateFinalize:()=>({status:'POSTED',test_only:false})}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_FINALIZE_INVALID');
});

test('blocks the unsafe six-actor grant model before any platform IAM write',async()=>{
  const calls=[];
  await assert.rejects(reconcileWbsTestImportActorGrants({scope,grantSync:{async reconcile(command){calls.push(command);}}}),error=>error.code==='WBS_TEST_IMPORT_GRANT_MODEL_UNSAFE');
  assert.equal(calls.length,0);assert.ok(WBS_TEST_IMPORT_GRANT_BUNDLES.poster.includes('GL.JE.POST'));assert.ok(WBS_TEST_IMPORT_GRANT_BUNDLES.poster.includes('BANK.RECONCILIATION.REOPEN'));
});
