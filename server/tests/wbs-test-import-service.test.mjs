import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsTestImportService,reconcileWbsTestImportActorGrants,WBS_TEST_IMPORT_GRANT_BUNDLES} from '../runtime/wbs-test-import-service.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='fe5a2a7c-3a26-4dd9-bdd8-6e46ba784231';
const uuid=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`,receiptHash=`sha256:${'d'.repeat(64)}`;
const actors={importer:'wbs-test-importer',reconciliationStarter:'wbs-test-reconciliation-starter',maker:'wbs-test-maker',paymentMaker:'wbs-test-payment-maker',matchMaker:'wbs-test-match-maker',submitter:'wbs-test-submitter',reviewer:'wbs-test-reviewer',approver:'wbs-test-approver',poster:'wbs-test-poster',clearer:'wbs-test-clearer',reopener:'wbs-test-reopener'};
const scope={tenantId,entityId,companyCode:'WBPA',actors};
const observation=(rows=[{source_record_hash:`sha256:${'a'.repeat(64)}`,currency:'USD',accounting_date:'2026-08-11',amount:'12.3000',status:'CLEAR'}])=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_payables',environment:'PRODUCTION',entity_id:entityId,captured_at:'2026-08-18T00:00:00.000Z',provider_content_sha256:'b'.repeat(64),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']},record_count:rows.length,rows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:`sha256:${'c'.repeat(64)}`});
const input={tenantId,entityId,periodId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',limit:10,idempotencyKey:'wbs-test-import-0001'};
const retained=idempotent=>({wbs_test_payable_source_receipt_id:uuid(1),receipt_hash:receiptHash,source_document_id:uuid(2),attachment_id:uuid(3),status:'RETAINED',idempotent,test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_post:false});
const draft=(idempotent=false,overrides={})=>({wbs_test_payable_source_receipt_id:uuid(1),receipt_hash:receiptHash,business_document_id:uuid(4),journal_entry_id:uuid(5),status:'DRAFT',revision:0,idempotent,test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',can_submit:false,can_review:false,can_approve:false,can_post:false,...overrides});

function harness({rows,mutateRetained,mutateDraft}={}){
  const calls=[],kernels={};
  for(const [role,actor] of Object.entries(actors))kernels[actor]={
    async retainWbsTestPayableSource(args){calls.push([role,'retain',args]);return mutateRetained?.(args)||retained(false);},
    async createWbsTestPayableDraft(args){calls.push([role,'draft',args]);return mutateDraft?.(args)||draft();},
    async transitionJournal(args){calls.push([role,args.action,args]);throw new Error('journal lifecycle must not be called');},
    async postJournal(args){calls.push([role,'POST',args]);throw new Error('post must not be called');},
    async finalizeWbsTestImportSource(args){calls.push([role,'finalize',args]);throw new Error('finalize must not be called');}
  };
  const pilotCalls=[],pilotService={async readObservation(args){pilotCalls.push(args);return observation(rows);}};
  return {calls,pilotCalls,service:createWbsTestImportService({pilotService,kernelForActor:actor=>kernels[actor],scope})};
}

test('service retains with SERVICE importer then creates only a human AP Draft from the exact receipt',async()=>{
  const {service,calls,pilotCalls}=harness();const result=await service.importPayables(input);
  assert.deepEqual(result,{status:'WBS_TEST_PAYABLE_IMPORT_COMPLETE',imported_count:1,replayed_count:0,posted_count:0,failed_count:0,test_only:true});
  assert.deepEqual(pilotCalls,[{tenantId,entityId,tool:'list_payables',limit:10,company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-12-31'}]);
  assert.deepEqual(calls.map(([role,action])=>[role,action]),[['importer','retain'],['maker','draft']]);
  assert.equal(calls[0][2].observation.status,'NOT_ADMITTED');
  assert.deepEqual(calls[1][2],{tenantId,entityId,sourceReceiptId:uuid(1),expectedReceiptHash:receiptHash,idempotencyKey:`${input.idempotencyKey}:${'a'.repeat(24)}:draft`});
});

test('retains exact signed non-zero Provider amount without lifecycle authority',async()=>{
  const row={source_record_hash:`sha256:${'e'.repeat(64)}`,currency:'USD',accounting_date:'2026-08-11',amount:'-12.3000',status:'CLEAR'};
  const {service,calls}=harness({rows:[row]});await service.importPayables(input);
  assert.equal(calls[0][2].row.amount,'-12.3000');assert.equal(calls[0][2].row.source_record_hash,row.source_record_hash);assert.equal(calls.length,2);
});

test('counts immutable source receipt replay and still stops at Draft',async()=>{
  const {service,calls}=harness({mutateRetained:()=>retained(true),mutateDraft:()=>draft(true)});const result=await service.importPayables(input);
  assert.deepEqual({imported:result.imported_count,replayed:result.replayed_count,posted:result.posted_count},{imported:0,replayed:1,posted:0});
  assert.deepEqual(calls.map(([role,action])=>[role,action]),[['importer','retain'],['maker','draft']]);
});

test('fails closed unless human Draft consumes exact retained identity and hash',async()=>{
  await assert.rejects(harness({mutateDraft:()=>draft(false,{receipt_hash:`sha256:${'f'.repeat(64)}`})}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_DRAFT_INVALID');
  await assert.rejects(harness({mutateDraft:()=>draft(false,{wbs_test_payable_source_receipt_id:uuid(9)})}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_DRAFT_INVALID');
});

test('rejects bad source inputs and unsafe persistence receipts',async()=>{
  const {service,calls}=harness();await assert.rejects(service.importPayables({...input,entityId:uuid(99)}),error=>error.code==='WBS_TEST_IMPORT_SCOPE_DENIED');
  await assert.rejects(harness({rows:[]}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_EMPTY');
  const duplicate={source_record_hash:`sha256:${'a'.repeat(64)}`,currency:'USD',accounting_date:'2026-08-11',amount:'12.3000',status:'CLEAR'};
  await assert.rejects(harness({rows:[duplicate,duplicate]}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_ROW_INVALID');
  await assert.rejects(harness({rows:[{...duplicate,amount:'0.0000'}]}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_ROW_INVALID');
  await assert.rejects(harness({mutateRetained:()=>({status:'RETAINED',test_only:true})}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_SOURCE_INVALID');
  await assert.rejects(harness({mutateDraft:()=>({status:'DRAFT',test_only:true})}).service.importPayables(input),error=>error.code==='WBS_TEST_IMPORT_DRAFT_INVALID');assert.equal(calls.length,0);
});

test('keeps WBS.TEST.IMPORT on the SERVICE importer and AP.BILL.CREATE on the human maker',async()=>{
  const calls=[];await reconcileWbsTestImportActorGrants({scope,grantSync:{async reconcile(command){calls.push(command);return {};}}});
  assert.equal(calls.length,11);assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.importer,['WBS.TEST.IMPORT']);
  assert.ok(WBS_TEST_IMPORT_GRANT_BUNDLES.maker.includes('AP.BILL.CREATE'));assert.equal(WBS_TEST_IMPORT_GRANT_BUNDLES.maker.includes('WBS.TEST.IMPORT'),false);
  assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.paymentMaker,['AP.PAYMENT.CREATE']);assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.poster,['GL.JE.POST']);assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.clearer,['BANK.RECONCILIATION.CLEAR']);assert.deepEqual(WBS_TEST_IMPORT_GRANT_BUNDLES.reopener,['BANK.RECONCILIATION.REOPEN']);
});
