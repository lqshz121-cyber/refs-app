import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsTestImportService,assertWbsControlledTestBankResult} from '../runtime/wbs-test-import-service.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha=x=>`sha256:${x.repeat(64)}`;
const tenantId=uuid(1),entityId=uuid(2),periodId=uuid(201);
const actors={importer:'range-importer',reconciliationStarter:'range-starter',maker:'range-maker',paymentMaker:'range-payment-maker',matchMaker:'range-match-maker',submitter:'range-submitter',reviewer:'range-reviewer',approver:'range-approver',poster:'range-poster',clearer:'range-clearer',reopener:'range-reopener'};
const scope={tenantId,entityId,companyCode:'WBPA',actors},input={tenantId,entityId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-01-31',pageSize:10,maxPages:1000,idempotencyKey:'wbs-month-2026-01-v1'};
const payable=(x,date)=>({source_record_hash:sha(x),currency:'USD',accounting_date:date,amount:'10.0000',status:'OPEN'}),bank=(x,date)=>({source_record_hash:sha(x),currency:'USD',accounting_date:date,amount:'20.0000',direction:'DEBIT',status:'OPEN'});

function harness({duplicate=false,completedReceipt=null}={}){
  const calls=[],retained=new Map(),bankReceipts=new Map(),populations={list_payables:[payable('a','2026-01-10'),payable(duplicate?'a':'b','2026-01-20')],list_bank_transactions:[bank('c','2026-01-12'),bank('d','2026-01-22')]};
  const pilotService={async readObservation(){throw new Error('not expected');},async readObservationPage(args){calls.push(['read',args]);const rows=populations[args.tool],observation={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:args.tool,environment:'PRODUCTION',entity_id:entityId,captured_at:'2026-08-19T12:00:00.000Z',provider_content_sha256:'f'.repeat(64),scope:{company_codes:['WBPA'],date_range:[args.date_from,args.date_to]},record_count:rows.length,rows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:sha(args.tool==='list_payables'?'e':'d')};return {observation,cursor_next:null,pagination:{snapshot_token:null,captured_at:observation.captured_at,contract_version:'WBS-REFS-MCP-V1',environment:'production',source_hash:sha('f'),first_stable_key:'001',last_stable_key:'002'}};}};
  const kernelForActor=actor=>({
    async readCompletedWbsTestMonthImport(args){calls.push(['completed',actor,args]);return completedReceipt;},
    async ensureWbsTestH12026Periods(){return {status:'WBS_TEST_H1_PERIODS_READY',periods:Array.from({length:6},(_,i)=>{const m=i+1,c=`2026-${String(m).padStart(2,'0')}`;return {period_id:uuid(200+m),period_code:c,starts_on:`${c}-01`,ends_on:new Date(Date.UTC(2026,m,0)).toISOString().slice(0,10)};}),test_only:true};},
    async retainWbsTestPayableSource(args){calls.push(['retain',actor,args]);if(retained.has(args.idempotencyKey))return {...retained.get(args.idempotencyKey),idempotent:true};const result={wbs_test_payable_source_receipt_id:uuid(300+retained.size),source_document_id:uuid(400+retained.size),attachment_id:uuid(500+retained.size),receipt_hash:sha(args.row.source_record_hash[7]),status:'RETAINED',test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_post:false,idempotent:false};retained.set(args.idempotencyKey,result);return result;},
    async createWbsTestPayableDraft(args){calls.push(['draft',actor,args]);return {wbs_test_payable_source_receipt_id:args.sourceReceiptId,receipt_hash:args.expectedReceiptHash,business_document_id:uuid(600),journal_entry_id:uuid(601),status:'DRAFT',revision:0,test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',can_submit:false,can_review:false,can_approve:false,can_post:false,idempotent:false};},
    async createWbsControlledTestBankScope(args){calls.push(['bank',actor,args]);if(bankReceipts.has(args.idempotencyKey))return {...bankReceipts.get(args.idempotencyKey),idempotent:true};const ids=args.observation.rows.map((_,i)=>uuid(700+i)),result={wbs_test_bank_import_receipt_id:uuid(710),receipt_hash:sha('9'),bank_source_ids:ids,bank_account_ref:args.bankAccountRef,statement_ending_date:args.observation.rows.at(-1).accounting_date,transaction_count:ids.length,status:'FINALIZED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,can_import:false,can_match:false,can_create_draft:false,can_post:false};bankReceipts.set(args.idempotencyKey,result);return result;}
  });
  return {calls,service:createWbsTestImportService({pilotService,kernelForActor,authorizeBank:async args=>calls.push(['authorize',args]),scope})};
}

test('range import retains Payable sources and FINALIZED Bank receipt without posting or reconciliation',async()=>{
  const {service,calls}=harness(),result=await service.importRange(input);
  assert.deepEqual(result.payables,{provider_page_count:1,h1_record_count:2,record_count:2,imported_count:2,replayed_count:0,posted_count:0});
  assert.deepEqual(result.bank.receipt,{bank_account_ref:'WBS_TEST_BANK_2026_01',period_code:'2026-01',period_id:periodId,wbs_test_bank_import_receipt_id:uuid(710),receipt_hash:sha('9'),transaction_count:2});
  assert.equal(Object.hasOwn(result.bank,'reconciliation'),false);assert.ok(calls.filter(([k])=>k==='retain').every(([,a])=>a===actors.importer));assert.ok(calls.filter(([k])=>k==='draft').every(([,a])=>a===actors.maker));
});

test('same-key replay never reports posting and reuses the Bank receipt',async()=>{
  const fixture=harness(),first=await fixture.service.importRange(input),second=await fixture.service.importRange(input);assert.deepEqual([second.payables.imported_count,second.payables.replayed_count,second.payables.posted_count],[0,2,0]);assert.equal(second.bank.receipt.wbs_test_bank_import_receipt_id,first.bank.receipt.wbs_test_bank_import_receipt_id);
});

test('returns completed immutable month receipt before Provider reads',async()=>{
  const completedReceipt={status:'WBS_TEST_MONTH_IMPORT_COMPLETE',period_code:'2026-01',date_from:'2026-01-01',date_to:'2026-01-31',page_size:10,payables:{provider_page_count:1,h1_record_count:2,record_count:2,imported_count:0,replayed_count:2,posted_count:0},bank:{provider_page_count:1,record_count:2,receipt:{bank_account_ref:'WBS_TEST_BANK_2026_01',period_code:'2026-01',period_id:periodId,wbs_test_bank_import_receipt_id:uuid(710),receipt_hash:sha('9'),transaction_count:2},bank_source_count:2},test_only:true};const {service,calls}=harness({completedReceipt});assert.deepEqual(await service.importRange(input),completedReceipt);assert.deepEqual(calls.map(([k])=>k),['authorize','completed']);
});

test('partial Bank checkpoint contract exposes no receipt IDs',()=>{const value={status:'WBS_TEST_BANK_IMPORT_PARTIAL',stage_id:uuid(999),next_chunk_index:20,chunk_count:21,transaction_count:2001,test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:false,can_import:false,can_match:false,can_create_draft:false,can_post:false};assert.equal(assertWbsControlledTestBankResult(value),value);assert.equal(Object.hasOwn(value,'wbs_test_bank_import_receipt_id'),false);});

test('duplicate Provider identity fails before source or Bank writes',async()=>{const {service,calls}=harness({duplicate:true});await assert.rejects(service.importRange(input),error=>error.code==='WBS_TEST_IMPORT_ROW_INVALID');assert.equal(calls.some(([k])=>['retain','bank'].includes(k)),false);});
