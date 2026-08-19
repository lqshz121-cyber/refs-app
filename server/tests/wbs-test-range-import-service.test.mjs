import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsTestImportService} from '../runtime/wbs-test-import-service.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=uuid(1),entityId=uuid(2);
const actors={importer:'range-importer',maker:'range-maker',submitter:'range-submitter',reviewer:'range-reviewer',approver:'range-approver',poster:'range-poster'};
const scope={tenantId,entityId,companyCode:'WBPA',actors};
const hash=letter=>`sha256:${letter.repeat(64)}`;
const observation=(tool,letter,date='2026-01-15')=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool,environment:'PRODUCTION',entity_id:entityId,captured_at:'2026-08-19T12:00:00.000Z',provider_content_sha256:letter.repeat(64),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-06-30']},record_count:1,rows:[tool==='list_payables'?{source_record_hash:hash(letter),currency:'USD',accounting_date:date,amount:'10.0000',status:'OPEN'}:{source_record_hash:hash(letter),currency:'USD',accounting_date:date,amount:'20.0000',direction:'DEBIT',status:'OPEN'}],signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash(letter)});

function harness({duplicate=false,loop=false}={}){
  const calls=[];let draft=0,bank=0;
  const pages={
    list_payables:[observation('list_payables','a'),observation('list_payables',duplicate?'a':'b','2026-06-30')],
    list_bank_transactions:[observation('list_bank_transactions','c'),observation('list_bank_transactions','d','2026-06-30')]
  };
  const pilotService={
    async readObservation(){throw new Error('legacy read not expected');},
    async readObservationPage(args){calls.push(['read',args]);const index=args.cursor===null?0:1;return {observation:pages[args.tool][index],cursor_next:index===0?'page-2':loop?'page-2':null};}
  };
  const kernelForActor=actor=>({
    async ensureWbsTestH12026Periods(args){calls.push(['periods',actor,args]);return {status:'WBS_TEST_H1_PERIODS_READY',periods:Array.from({length:6},(_,index)=>{const month=index+1,code=`2026-${String(month).padStart(2,'0')}`;return {period_id:uuid(200+month),period_code:code,starts_on:`${code}-01`,ends_on:new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10)};}),test_only:true};},
    async createWbsTestPayableDraft(args){calls.push(['draft',actor,args]);const n=++draft*10;return {business_document_id:uuid(n+1),journal_entry_id:uuid(n+2),source_document_id:uuid(n+3),attachment_id:uuid(n+4),status:'DRAFT',revision:0,idempotent:false,test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY'};},
    async transitionJournal(args){calls.push(['transition',actor,args]);return {status:{SUBMIT:'PENDING_REVIEW',REVIEW:'PENDING_APPROVAL',APPROVE:'APPROVED'}[args.action]};},
    async postJournal(args){calls.push(['post',actor,args]);return {journal_entry_id:args.journalEntryId,posting_batch_id:uuid(80+draft),idempotent:false,revision:4};},
    async finalizeWbsTestImportSource(args){calls.push(['finalize',actor,args]);return {status:'POSTED',test_only:true,idempotent:false};},
    async createWbsControlledTestBankScope(args){calls.push(['bank',actor,args]);const n=++bank,ids=args.observation.rows.map((_,index)=>uuid(120+n+index));return {wbs_controlled_test_bank_import_id:uuid(100+n),reconciliation_id:uuid(110+n),bank_source_ids:ids,bank_account_ref:args.bankAccountRef,statement_ending_date:args.observation.rows.at(-1).accounting_date,transaction_count:ids.length,status:'DRAFT',provenance_mode:'CONTROLLED_TEST_UNSIGNED',test_only:true,idempotent:false};}
  });
  return {calls,service:createWbsTestImportService({pilotService,kernelForActor,authorizeBank:async args=>calls.push(['authorize',args]),scope})};
}

const input={tenantId,entityId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-06-30',pageSize:10,maxPages:2,idempotencyKey:'wbs-h1-2026-v1'};

test('reads all Payable and Bank cursor pages before importing the H1 TEST_ONLY range',async()=>{
  const {service,calls}=harness();const result=await service.importRange(input);
  assert.deepEqual(result,{status:'WBS_TEST_RANGE_IMPORT_COMPLETE',date_from:'2026-01-01',date_to:'2026-06-30',page_size:10,payables:{page_count:2,record_count:2,imported_count:2,replayed_count:0,posted_count:2},bank:{provider_page_count:2,record_count:2,reconciliations:[{bank_account_ref:'WBS_TEST_BANK_2026_01',period_code:'2026-01',reconciliation_id:uuid(111),transaction_count:1},{bank_account_ref:'WBS_TEST_BANK_2026_06',period_code:'2026-06',reconciliation_id:uuid(112),transaction_count:1}],bank_source_ids:[uuid(121),uuid(122)]},test_only:true});
  assert.equal(calls.filter(([kind])=>kind==='read').length,4);assert.equal(calls.findIndex(([kind])=>kind==='draft')>calls.map(([kind])=>kind).lastIndexOf('read'),true);
  assert.deepEqual(calls.filter(([kind])=>kind==='read').map(([,args])=>[args.tool,args.cursor]),[['list_payables',null],['list_bank_transactions',null],['list_payables','page-2'],['list_bank_transactions','page-2']]);
  assert.ok(calls.filter(([kind])=>kind==='draft').every(([,actor,args])=>actor===actors.maker&&args.row.accounting_date>='2026-01-01'&&args.row.accounting_date<='2026-06-30'&&args.idempotencyKey.includes(args.row.source_record_hash.slice(7,31))));
  const bankCall=calls.filter(([kind])=>kind==='bank');assert.equal(bankCall.length,2);assert.equal(bankCall[0][1],actors.importer);assert.deepEqual(bankCall.map(([, ,args])=>[args.bankAccountRef,args.periodId,args.observation.rows[0].accounting_date]),[['WBS_TEST_BANK_2026_01',uuid(201),'2026-01-15'],['WBS_TEST_BANK_2026_06',uuid(206),'2026-06-30']]);
});

test('rejects duplicate source hashes, cursor loops, and truncation before accounting writes',async()=>{
  for(const options of [{duplicate:true},{loop:true}]){
    const {service,calls}=harness(options);await assert.rejects(service.importRange(input),error=>error.code==='WBS_TEST_IMPORT_ROW_INVALID');assert.equal(calls.some(([kind])=>['draft','bank'].includes(kind)),false);
  }
  const {service,calls}=harness();await assert.rejects(service.importRange({...input,maxPages:1}),error=>error.code==='WBS_TEST_IMPORT_PAGE_LIMIT_EXCEEDED');assert.equal(calls.some(([kind])=>['draft','bank'].includes(kind)),false);
});
