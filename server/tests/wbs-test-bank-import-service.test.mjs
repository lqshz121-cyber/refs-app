import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsTestImportService} from '../runtime/wbs-test-import-service.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='fe5a2a7c-3a26-4dd9-bdd8-6e46ba784231';
const actors={importer:'wbs-test-importer',reconciliationStarter:'wbs-test-starter',maker:'wbs-test-maker',paymentMaker:'wbs-test-payment-maker',matchMaker:'wbs-test-match-maker',submitter:'wbs-test-submitter',reviewer:'wbs-test-reviewer',approver:'wbs-test-approver',poster:'wbs-test-poster',clearer:'wbs-test-clearer',reopener:'wbs-test-reopener'};
const scope={tenantId,entityId,companyCode:'WBPA',actors};
const rows=[{source_record_hash:`sha256:${'a'.repeat(64)}`,currency:'USD',accounting_date:'2026-08-11',amount:'12.3000',direction:'DEBIT',status:'POSTED'}];
const observation=(candidate=rows)=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_bank_transactions',environment:'PRODUCTION',entity_id:entityId,captured_at:'2026-08-18T00:00:00.000Z',provider_content_sha256:'b'.repeat(64),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']},record_count:candidate.length,rows:candidate,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:`sha256:${'c'.repeat(64)}`});
const input={tenantId,entityId,periodId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',limit:10,idempotencyKey:'wbs-test-bank-0001'};
const output={wbs_test_bank_import_receipt_id:'00000001-0000-4000-8000-000000000001',receipt_hash:`sha256:${'d'.repeat(64)}`,bank_source_ids:['00000003-0000-4000-8000-000000000001'],bank_account_ref:'WBS_TEST_BANK',statement_ending_date:'2026-08-11',transaction_count:1,status:'FINALIZED',provenance_mode:'CONTROLLED_TEST_UNSIGNED',test_only:true,idempotent:false,can_import:false,can_match:false,can_create_draft:false,can_post:false};

function harness({observed=observation(),result=output,authorizeBank=async()=>{}}={}){
  const calls=[];const service=createWbsTestImportService({scope,authorizeBank:async args=>{calls.push(['authorize',args]);return authorizeBank(args);},pilotService:{async readObservation(args){calls.push(['read',args]);return observed;}},kernelForActor:actor=>({async createWbsControlledTestBankScope(args){calls.push(['create',actor,args]);return result;}})});return {service,calls};
}

test('retains a bounded Bank observation as one immutable FINALIZED receipt without reconciliation',async()=>{
  const {service,calls}=harness();assert.deepEqual(await service.importBankTransactions(input),output);
  assert.deepEqual(calls[0],['authorize',{tenantId,entityId}]);assert.deepEqual(calls[1],['read',{tenantId,entityId,tool:'list_bank_transactions',limit:10,company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-12-31'}]);
  assert.equal(calls[2][1],actors.importer);assert.equal(calls[2][2].bankAccountRef,'WBS_TEST_BANK');assert.deepEqual(calls[2][2].observation,observation());
});

test('fails before the kernel on scope, authorization, row and result violations',async()=>{
  await assert.rejects(harness().service.importBankTransactions({...input,entityId:'00000009-0000-4000-8000-000000000001'}),error=>error.code==='WBS_TEST_IMPORT_SCOPE_DENIED');
  const denied=harness({authorizeBank:async()=>{throw Object.assign(new Error('denied'),{code:'PERMISSION_DENIED'});}});await assert.rejects(denied.service.importBankTransactions(input),error=>error.code==='PERMISSION_DENIED');assert.equal(denied.calls.some(call=>call[0]==='read'),false);
  await assert.rejects(harness({observed:observation([{...rows[0],direction:'UNKNOWN'}])}).service.importBankTransactions(input),error=>error.code==='WBS_TEST_BANK_ROW_INVALID');
  await assert.rejects(harness({result:{...output,test_only:false}}).service.importBankTransactions(input),error=>error.code==='WBS_TEST_BANK_RESULT_INVALID');
});

test('requires explicit caller authorization wiring and an exact configured company/date scope',async()=>{
  const noAuth=createWbsTestImportService({scope,pilotService:{readObservation:async()=>observation()},kernelForActor:()=>({createWbsControlledTestBankScope:async()=>output})});
  await assert.rejects(noAuth.importBankTransactions(input),error=>error.code==='WBS_TEST_IMPORT_CONFIG_INVALID');
  await assert.rejects(harness({observed:{...observation(),scope:{company_codes:['OTHER'],date_range:['2026-01-01','2026-12-31']}}}).service.importBankTransactions(input),error=>error.code==='WBS_TEST_IMPORT_SCOPE_DENIED');
});
